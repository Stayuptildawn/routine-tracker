import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import { exportCardioLogs, exportCheckins, exportReminders, exportTaskLogs, exportTrainingSets, exportWorkoutLogs } from '../lib/csv'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'

interface DayStat {
  date: string
  dayName: string
  done: number
  skipped: number
}

// ---- data explorer: up to 3 years, bucketed server-side ----
type Metric = 'tasks' | 'sets' | 'cardio'
type Frame = 'daily' | 'weekly' | 'monthly' | 'half' | 'yearly'

const METRICS: { id: Metric; label: string; icon: IconName; unit: string }[] = [
  { id: 'tasks', label: 'Tasks', icon: 'tasks', unit: '' },
  { id: 'sets', label: 'Sets', icon: 'dumbbell', unit: '' },
  { id: 'cardio', label: 'Cardio', icon: 'run', unit: ' km' },
]

// every range ends now / today / this week / this month
const FRAMES: { id: Frame; label: string; hint: string }[] = [
  { id: 'daily', label: 'D', hint: 'last 24 hours' },
  { id: 'weekly', label: 'W', hint: 'last 7 days' },
  { id: 'monthly', label: 'M', hint: 'last 32 days' },
  { id: 'half', label: '6M', hint: 'last 6 months, weekly' },
  { id: 'yearly', label: 'Y', hint: 'last 12 months' },
]

const FRAME_BUCKET: Record<Frame, string> = {
  daily: 'hour',
  weekly: 'day',
  monthly: 'day',
  half: 'week',
  yearly: 'month',
}

interface Slot {
  key: string // bucket start: yyyy-mm-dd, or yyyy-mm-ddThh for hour buckets (UTC)
  label: string // sparse axis label, '' = unlabeled
}

function buildSlots(frame: Frame): Slot[] {
  const today = new Date()
  const slots: Slot[] = []
  const dm = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`
  if (frame === 'daily') {
    // 24 hourly buckets ending with the current hour; keys in UTC to match
    // the database's hour truncation, labels in local time
    const hour = new Date()
    hour.setMinutes(0, 0, 0)
    for (let i = 23; i >= 0; i--) {
      const d = new Date(hour)
      d.setHours(d.getHours() - i)
      slots.push({ key: d.toISOString().slice(0, 13), label: i % 6 === 0 ? `${d.getHours()}h` : '' })
    }
  } else if (frame === 'weekly') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      slots.push({ key: localDate(d), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }) })
    }
  } else if (frame === 'monthly') {
    for (let i = 31; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      slots.push({ key: localDate(d), label: i % 7 === 3 ? dm(d) : '' })
    }
  } else if (frame === 'half') {
    // ~6 months as Monday-to-Sunday weeks
    const monday = new Date(today)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    for (let i = 25; i >= 0; i--) {
      const d = new Date(monday)
      d.setDate(d.getDate() - i * 7)
      slots.push({ key: localDate(d), label: i % 5 === 0 ? dm(d) : '' })
    }
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      slots.push({ key: localDate(d), label: d.toLocaleDateString(undefined, { month: 'narrow' }) })
    }
  }
  return slots
}

interface Reflection {
  week_start: string
  body: string
}

export default function Reflect({ visible }: { visible: boolean }) {
  const [days, setDays] = useState<DayStat[]>([])
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [metric, setMetric] = useState<Metric>('tasks')
  const [frame, setFrame] = useState<Frame>('daily')
  const [explore, setExplore] = useState<{ slots: Slot[]; values: number[] } | null>(null)

  const lastExploreQuery = useRef('')

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    // blank the chart only when the query changed; a plain tab revisit
    // keeps the old bars on screen while fresh numbers load behind them
    const query = `${metric}:${frame}`
    if (query !== lastExploreQuery.current) setExplore(null)
    lastExploreQuery.current = query
    const slots = buildSlots(frame)
    const bucket = FRAME_BUCKET[frame]
    const startTs = frame === 'daily' ? slots[0].key + ':00:00' : slots[0].key + 'T00:00:00'
    supabase.rpc('explore_buckets', { metric, bucket, start_ts: startTs }).then(({ data }) => {
      if (cancelled) return
      // the RPC returns naive timestamps; keys match on hour or day precision
      const cut = frame === 'daily' ? 13 : 10
      const byKey = new Map<string, number>()
      for (const r of ((data as { b: string; v: number }[]) ?? [])) {
        const k = r.b.slice(0, cut)
        byKey.set(k, (byKey.get(k) ?? 0) + Number(r.v))
      }
      setExplore({ slots, values: slots.map((s) => byKey.get(s.key) ?? 0) })
    })
    return () => {
      cancelled = true
    }
  }, [visible, metric, frame])

  useEffect(() => {
    if (!visible) return
    supabase
      .from('reflections')
      .select('week_start, body')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setReflection(data as Reflection | null))
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const from = new Date()
    from.setDate(from.getDate() - 6)
    const fromDate = localDate(from)
    Promise.all([
      supabase.from('task_logs').select('date, status').gte('date', fromDate),
      // workouts count too: a finished session, a cardio entry, a freeform lift
      supabase.from('planned_sessions').select('completed_at').gte('completed_at', fromDate + 'T00:00:00'),
      supabase.from('cardio_logs').select('date').gte('date', fromDate),
      supabase.from('workout_logs').select('date').gte('date', fromDate),
    ]).then(([tasksRes, sessionsRes, cardioRes, liftsRes]) => {
      const sessionDates = (sessionsRes.data ?? [])
        .filter((s) => s.completed_at)
        .map((s) => localDate(new Date(s.completed_at)))
      const stats: DayStat[] = []
      for (let i = 6; i >= 0; i--) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const date = localDate(d)
        const dayLogs = (tasksRes.data ?? []).filter((l) => l.date === date)
        stats.push({
          date,
          dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
          done:
            dayLogs.filter((l) => l.status === 'done' || l.status === 'partial').length +
            sessionDates.filter((s) => s === date).length +
            (cardioRes.data ?? []).filter((c) => c.date === date).length +
            (liftsRes.data ?? []).filter((w) => w.date === date).length,
          skipped: dayLogs.filter((l) => l.status === 'skipped').length,
        })
      }
      setDays(stats)
      setLoaded(true)
    })
  }, [visible])

  const totalDone = days.reduce((n, d) => n + d.done, 0)
  const max = Math.max(1, ...days.map((d) => d.done))
  const strongest = days.length ? days.reduce((a, b) => (b.done > a.done ? b : a)) : null

  return (
    <div className="reflect">
      <h1>This week, gently</h1>
      <p className="gentle">
        Patterns, not judgment. No streaks here — a quiet day is information, not failure.
      </p>
      {reflection && (() => {
        const monday = new Date()
        monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
        const thisWeek = reflection.week_start === localDate(monday)
        return (
          <div className="reflection-card">
            <p className="eyebrow">{thisWeek ? 'Noticed this week' : 'Noticed recently'}</p>
            <p className="reflection-body">{reflection.body}</p>
          </div>
        )
      })()}
      {!loaded && <Skeleton cards={1} />}
      <div className="reflect-bars" style={loaded ? undefined : { display: 'none' }}>
        {days.map((d) => (
          <div key={d.date} className="reflect-day">
            <div className="bar-wrap">
              <div className="bar" style={{ height: `${(d.done / max) * 100}%` }} />
            </div>
            <span className="bar-count">{d.done || ''}</span>
            <span className="bar-day">{d.dayName}</span>
          </div>
        ))}
      </div>
      {!loaded ? null : totalDone > 0 ? (
        <div className="reflect-notes">
          <p>
            You completed <strong>{totalDone}</strong> things this week — tasks, gym sessions and
            cardio all count.
            {strongest && strongest.done > 0 && <> {strongest.dayName} was your strongest day.</>}
          </p>
          {days.reduce((n, d) => n + d.skipped, 0) > 0 && (
            <p>
              You consciously skipped {days.reduce((n, d) => n + d.skipped, 0)} — that’s
              self-management, not slacking.
            </p>
          )}
        </div>
      ) : (
        <p className="gentle">Nothing logged yet this week. Whenever you’re ready.</p>
      )}

      <section className="reflect-bars explore-card">
        <div className="explore-inner">
          <h2>
            Explore
            <span className="routine-progress">
              {' '}
              {FRAMES.find((f) => f.id === frame)?.hint}
              {explore
                ? ` · ${metric === 'cardio' ? `${Math.round(explore.values.reduce((a, b) => a + b, 0) * 10) / 10} km` : `${Math.round(explore.values.reduce((a, b) => a + b, 0))} total`}`
                : ''}
            </span>
          </h2>
          <div className="energy-row explore-row">
            {METRICS.map((m) => (
              <button key={m.id} className={metric === m.id ? 'energy-btn active' : 'energy-btn'} onClick={() => setMetric(m.id)}>
                <Icon name={m.icon} /> {m.label}
              </button>
            ))}
          </div>
          <div className="energy-row explore-row">
            {FRAMES.map((f) => (
              <button key={f.id} className={frame === f.id ? 'energy-btn active' : 'energy-btn'} onClick={() => setFrame(f.id)}>
                {f.label}
              </button>
            ))}
          </div>
          {explore && (
            <p className="gentle explore-stats">
              {(() => {
                const vs = explore.values
                const f = (v: number) => (metric === 'cardio' ? Math.round(v * 10) / 10 : Math.round(v * 10) / 10)
                const unit = metric === 'cardio' ? ' km' : ''
                return `Min ${f(Math.min(...vs))}${unit} · Max ${f(Math.max(...vs))}${unit} · Avg ${f(vs.reduce((a, b) => a + b, 0) / vs.length)}${unit}`
              })()}
            </p>
          )}
          {explore ? (
            <div className="explore-bars">
              {(() => {
                const max = Math.max(1, ...explore.values)
                return explore.slots.map((s, i) => {
                  const v = explore.values[i]
                  const shown = metric === 'cardio' ? Math.round(v * 10) / 10 : Math.round(v)
                  return (
                    <div key={s.key} className="explore-col" title={`${s.key}: ${shown}${metric === 'cardio' ? ' km' : ''}`}>
                      <div className="bar-wrap explore-wrap">
                        <div className={i === explore.slots.length - 1 ? 'bar explore-bar now' : 'bar explore-bar'} style={{ height: `${(v / max) * 100}%` }} />
                      </div>
                      {explore.slots.length <= 12 && <span className="bar-count">{shown || ''}</span>}
                      <span className="bar-day">{s.label}</span>
                    </div>
                  )
                })
              })()}
            </div>
          ) : (
            <p className="gentle">Loading…</p>
          )}
        </div>
      </section>

      <p className="gentle export-row">
        Your data is yours:
        <button className="link" onClick={() => exportTaskLogs()}>
          <Icon name="download" /> tasks CSV
        </button>
        <button className="link" onClick={() => exportWorkoutLogs()}>
          <Icon name="download" /> workouts CSV
        </button>
        <button className="link" onClick={() => exportCardioLogs()}>
          <Icon name="download" /> cardio CSV
        </button>
        <button className="link" onClick={() => exportTrainingSets()}>
          <Icon name="download" /> training CSV
        </button>
        <button className="link" onClick={() => exportCheckins()}>
          <Icon name="download" /> check-ins CSV
        </button>
        <button className="link" onClick={() => exportReminders()}>
          <Icon name="download" /> reminders CSV
        </button>
      </p>
    </div>
  )
}
