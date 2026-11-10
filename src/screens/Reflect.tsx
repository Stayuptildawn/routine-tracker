import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import { useCardioTracking } from '../lib/cardioTracking'
import { t, locale } from '../i18n'
import Skeleton from '../components/Skeleton'
import type { IconName } from '../components/Icon'
import { Card, Disclosure, ListRow, ScreenHeader, Segmented } from '../components/ui'

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
  { id: 'tasks', label: t.reflect.metricTasks, icon: 'tasks', unit: '' },
  { id: 'sets', label: t.reflect.metricSets, icon: 'dumbbell', unit: '' },
  { id: 'cardio', label: t.reflect.metricCardio, icon: 'run', unit: ' km' },
]

// every range ends now / today / this week / this month
const FRAMES: Frame[] = ['daily', 'weekly', 'monthly', 'half', 'yearly']

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
      slots.push({ key: d.toISOString().slice(0, 13), label: i % 6 === 0 ? t.reflect.hourLabel(d.getHours()) : '' })
    }
  } else if (frame === 'weekly') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today)
      d.setDate(d.getDate() - i)
      slots.push({ key: localDate(d), label: d.toLocaleDateString(locale, { weekday: 'narrow' }) })
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
      slots.push({ key: localDate(d), label: d.toLocaleDateString(locale, { month: 'narrow' }) })
    }
  }
  return slots
}

interface Reflection {
  week_start: string
  body: string
}

interface TrainingReview {
  week_start: string
  body: string
  advice: string
}

interface MonthlyReflection {
  month_start: string
  body: string
}

export default function Reflect({
  visible,
  onOpenSettings,
  onOpenLog,
}: {
  visible: boolean
  onOpenSettings: () => void
  onOpenLog: () => void
}) {
  const [days, setDays] = useState<DayStat[]>([])
  const [reflection, setReflection] = useState<Reflection | null>(null)
  const [training, setTraining] = useState<TrainingReview | null>(null) // latest weekly AI training review
  const [monthly, setMonthly] = useState<MonthlyReflection[]>([]) // end-of-month summaries, newest first
  const [showMonthly, setShowMonthly] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [pickedMetric, setMetric] = useState<Metric>('tasks')
  // cardio logging switched off in Settings: its chart and CSV step aside
  const cardioOn = useCardioTracking()
  const metric = !cardioOn && pickedMetric === 'cardio' ? 'tasks' : pickedMetric
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
    supabase
      .from('training_reviews')
      .select('week_start, body, advice')
      .order('week_start', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setTraining(data as TrainingReview | null))
    // the long memory: one summary per month, written at month end by the
    // reflection cron - twelve months is the whole shelf
    supabase
      .from('monthly_reflections')
      .select('month_start, body')
      .order('month_start', { ascending: false })
      .limit(12)
      .then(({ data }) => setMonthly((data as MonthlyReflection[]) ?? []))
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
          dayName: d.toLocaleDateString(locale, { weekday: 'short' }),
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

  const exploreTotal = explore ? explore.values.reduce((a, b) => a + b, 0) : 0
  const skipped = days.reduce((n, d) => n + d.skipped, 0)

  return (
    <div className="screen reflect">
      <ScreenHeader title={t.reflect.title} lede={t.reflect.subtitle} onOpenSettings={onOpenSettings} />

      {reflection &&
        (() => {
          const monday = new Date()
          monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7))
          const thisWeek = reflection.week_start === localDate(monday)
          return (
            <section className="card reflection">
              <p className="eyebrow">{thisWeek ? t.reflect.noticedThisWeek : t.reflect.noticedRecently}</p>
              <p className="reflection__body">{reflection.body}</p>
            </section>
          )
        })()}
      {training && (
        <section className="card reflection">
          <p className="eyebrow">{t.reflect.trainingTitle}</p>
          <p className="reflection__body">{training.body}</p>
        </section>
      )}
      {monthly.length > 0 && (
        <Disclosure label={t.reflect.monthlyReflections(monthly.length)} open={showMonthly} onToggle={setShowMonthly}>
          {monthly.map((m) => (
            <section key={m.month_start} className="card reflection">
              <p className="eyebrow">
                {new Date(m.month_start + 'T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
              </p>
              <p className="reflection__body">{m.body}</p>
            </section>
          ))}
        </Disclosure>
      )}

      {!loaded && <Skeleton cards={1} />}
      {loaded && (
        <Card>
          <div className="bars" style={{ ['--bars-h' as string]: '96px' }}>
            {days.map((d) => (
              <div key={d.date} className="bars__col">
                <span className="bars__value">{d.done || ''}</span>
                <div className="bars__track">
                  <div className="bars__bar" style={{ height: `${Math.max((d.done / max) * 100, 2)}%` }} />
                </div>
                <span className="bars__label">{d.dayName}</span>
              </div>
            ))}
          </div>
          {totalDone > 0 ? (
            <>
              <p>
                {t.reflect.completedLead}
                <strong>{totalDone}</strong>
                {t.reflect.completedTail}
                {strongest && strongest.done > 0 && <>{t.reflect.strongestDay(strongest.dayName)}</>}
              </p>
              {skipped > 0 && <p>{t.reflect.skippedNote(skipped)}</p>}
            </>
          ) : (
            <p className="hint">{t.reflect.nothingLogged}</p>
          )}
        </Card>
      )}

      <Card
        title={t.reflect.explore}
        meta={
          <>
            {t.reflect.frames[frame]?.hint}
            {explore
              ? ` · ${metric === 'cardio' ? t.reflect.kmTotal(Math.round(exploreTotal * 10) / 10) : t.reflect.total(Math.round(exploreTotal))}`
              : ''}
          </>
        }
      >
        <Segmented
          label={t.reflect.explore}
          value={metric}
          onChange={setMetric}
          options={METRICS.filter((m) => cardioOn || m.id !== 'cardio').map((m) => ({ value: m.id, label: m.label, icon: m.icon }))}
        />
        {/* the single letters mean nothing until you've picked one, and touch
            has no hover to reveal it - each option carries its hint */}
        <Segmented
          value={frame}
          onChange={setFrame}
          options={FRAMES.map((f) => ({ value: f, label: t.reflect.frames[f]?.label, hint: t.reflect.frames[f]?.hint }))}
        />
        {explore ? (
          <>
            <p className="hint">
              {(() => {
                const vs = explore.values
                const f = (v: number) => Math.round(v * 10) / 10
                const unit = metric === 'cardio' ? ' km' : ''
                return t.reflect.minMaxAvg(
                  `${f(Math.min(...vs))}${unit}`,
                  `${f(Math.max(...vs))}${unit}`,
                  `${f(vs.reduce((a, b) => a + b, 0) / vs.length)}${unit}`,
                )
              })()}
            </p>
            <div className={explore.slots.length > 12 ? 'bars bars--dense' : 'bars'} style={{ ['--bars-h' as string]: '110px' }}>
              {(() => {
                const top = Math.max(1, ...explore.values)
                return explore.slots.map((s, i) => {
                  const v = explore.values[i]
                  const shown = metric === 'cardio' ? Math.round(v * 10) / 10 : Math.round(v)
                  const last = i === explore.slots.length - 1
                  return (
                    <div key={s.key} className="bars__col" title={`${s.key}: ${shown}${metric === 'cardio' ? ' km' : ''}`}>
                      {explore.slots.length <= 12 && <span className="bars__value">{shown || ''}</span>}
                      <div className="bars__track">
                        <div className={last ? 'bars__bar' : 'bars__bar bars__bar--muted'} style={{ height: `${(v / top) * 100}%` }} />
                      </div>
                      <span className="bars__label">{s.label}</span>
                    </div>
                  )
                })
              })()}
            </div>
          </>
        ) : (
          <p className="hint">{t.common.loading}</p>
        )}
      </Card>

      <ListRow icon="bot" label={t.history.title} onClick={onOpenLog} />
    </div>
  )
}
