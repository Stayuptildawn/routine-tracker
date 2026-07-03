import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'

interface DayStat {
  date: string
  dayName: string
  done: number
  skipped: number
}

export default function Reflect() {
  const [days, setDays] = useState<DayStat[]>([])

  useEffect(() => {
    const from = new Date()
    from.setDate(from.getDate() - 6)
    supabase
      .from('task_logs')
      .select('date, status')
      .gte('date', localDate(from))
      .then(({ data }) => {
        const stats: DayStat[] = []
        for (let i = 6; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const date = localDate(d)
          const dayLogs = (data ?? []).filter((l) => l.date === date)
          stats.push({
            date,
            dayName: d.toLocaleDateString(undefined, { weekday: 'short' }),
            done: dayLogs.filter((l) => l.status === 'done' || l.status === 'partial').length,
            skipped: dayLogs.filter((l) => l.status === 'skipped').length,
          })
        }
        setDays(stats)
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
      <div className="reflect-bars">
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
      {totalDone > 0 ? (
        <div className="reflect-notes">
          <p>
            You completed <strong>{totalDone}</strong> tasks this week.
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
    </div>
  )
}
