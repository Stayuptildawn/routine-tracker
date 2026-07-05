import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import { exportCardioLogs, exportTaskLogs, exportWorkoutLogs } from '../lib/csv'
import Skeleton from '../components/Skeleton'

interface DayStat {
  date: string
  dayName: string
  done: number
  skipped: number
}

// ---- data explorer: up to 3 years, bucketed server-side ----
type Metric = 'tasks' | 'sets' | 'cardio'
type Frame = 'daily' | 'weekly' | 'monthly' | 'half' | 'yearly'

const METRICS: { id: Metric; label: string; unit: string }[] = [
  { id: 'tasks', label: '✅ Tasks', unit: '' },
  { id: 'sets', label: '🏋️ Sets', unit: '' },
  { id: 'cardio', label: '🏃 Cardio', unit: ' km' },
]

// every range ends today / this week / this month
const FRAMES: { id: Frame; label: string; hint: string }[] = [
  { id: 'daily', label: 'D', hint: 'last 30 days' },
  { id: 'weekly', label: 'W', hint: 'last 26 weeks' },
  { id: 'monthly', label: 'M', hint: 'last 3 years, monthly' },
  { id: 'half', label: '6M', hint: 'last 3 years in half-years' },
  { id: 'yearly', label: 'Y', hint: 'the last 12 months' },
]

interface Slot {
  key: string // bucket start, yyyy-mm-dd (as the RPC returns it)
  label: string // sparse axis label, '' = unlabeled
}

function buildSlots(frame: Frame): Slot[] {
  const today = new Date()
  const slots: Slot[] = []
  const dm = (d: Date) => `${d.getDate()}/${d.getMonth() + 1}`
  if (frame === 'daily') {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      slots.push({ key: localDate(d), label: i % 7 === 0 ? dm(d) : '' })
    }
  } else if (frame === 'weekly') {
    const monday = new Date(today)
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
    for (let i = 25; i >= 0; i--) {
      const d = new Date(monday)
      d.setDate(d.getDate() - i * 7)
      slots.push({ key: localDate(d), label: i % 5 === 0 ? dm(d) : '' })
    }
  } else if (frame === 'monthly') {
    for (let i = 35; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      slots.push({ key: localDate(d), label: i % 6 === 0 ? `${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}` : '' })
    }
  } else if (frame === 'yearly') {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
      slots.push({ key: localDate(d), label: d.toLocaleDateString(undefined, { month: 'narrow' }) })
    }
  } else {
    // half-years: the six 6-month blocks containing today, aligned Jan/Jul
    const startMonth = today.getMonth() < 6 ? 0 : 6
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), startMonth - i * 6, 1)
      slots.push({ key: localDate(d), label: `${d.getMonth() === 0 ? 'H1' : 'H2'}’${String(d.getFullYear()).slice(2)}` })
    }
  }
  return slots
}

interface Reflection {
  week_start: string
  body: string
}

export default function Reflect() {
  const [days, setDays] = useState<DayStat[]>([])
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [metric, setMetric] = useState<Metric>('tasks')
  const [frame, setFrame] = useState<Frame>('daily')
  const [explore, setExplore] = useState<{ slots: Slot[]; values: number[] } | null>(null)

  useEffect(() => {
    let cancelled = false
    setExplore(null)
    const slots = buildSlots(frame)
    const bucket = frame === 'daily' ? 'day' : frame === 'weekly' ? 'week' : 'month'
    supabase.rpc('explore_buckets', { metric, bucket, start_date: slots[0].key }).then(({ data }) => {
      if (cancelled) return
      const byKey = new Map<string, number>(
        ((data as { b: string; v: number }[]) ?? []).map((r) => [r.b, Number(r.v)]),
      )
      let values: number[]
      if (frame === 'half') {
        values = slots.map((s) => {
          const start = new Date(s.key + 'T00:00:00')
          let sum = 0
          for (let m = 0; m < 6; m++) {
            sum += byKey.get(localDate(new Date(start.getFullYear(), start.getMonth() + m, 1))) ?? 0
          }
          return sum
        })
      } else {
        values = slots.map((s) => byKey.get(s.key) ?? 0)
      }
      setExplore({ slots, values })
    })
    return () => {
      cancelled = true
    }
  }, [metric, frame])

  useEffect(() => {
    supabase
      .from('reflections')
      .select('week_start, body')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setReflection(data as Reflection | null))
  }, [])

  useEffect(() => {
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
  }, [])

  const totalDone = days.reduce((n, d) => n + d.done, 0)
  const max = Math.max(1, ...days.map((d) => d.done))
  const strongest = days.length ? days.reduce((a, b) => (b.done > a.done ? b : a)) : null

  return (
    <div className="reflect">
      <h1>This week, gently</h1>
      <p className="gentle">
        Patterns, not judgment. No streaks here — a quiet day is information, not failure.
      </p>
      {reflection && (
        <div className="reflection-card">
          <p className="eyebrow">
            Noticed, week of{' '}
            {new Date(reflection.week_start + 'T00:00:00').toLocaleDateString(undefined, {
              day: 'numeric',
              month: 'long',
            })}
          </p>
          <p className="reflection-body">{reflection.body}</p>
        </div>
      )}
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
                {m.label}
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
          ⬇ tasks CSV
        </button>
        <button className="link" onClick={() => exportWorkoutLogs()}>
          ⬇ workouts CSV
        </button>
        <button className="link" onClick={() => exportCardioLogs()}>
          ⬇ cardio CSV
        </button>
      </p>
    </div>
  )
}
