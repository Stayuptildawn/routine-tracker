import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { WorkoutLog } from '../lib/types'

export default function Gym() {
  const [logs, setLogs] = useState<WorkoutLog[]>([])

  useEffect(() => {
    supabase
      .from('workout_logs')
      .select('*')
      .order('date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200)
      .then(({ data }) => setLogs((data as WorkoutLog[]) ?? []))
  }, [])

  const byDate = new Map<string, WorkoutLog[]>()
  for (const log of logs) {
    const list = byDate.get(log.date) ?? []
    list.push(log)
    byDate.set(log.date, list)
  }

  return (
    <div className="gym">
      <h1>Workout log</h1>
      <p className="gentle">
        This is your exercise logbook — sets, weights, reps. Log from the Now tab:{' '}
        <em>“bench 60kg 3x8, felt easy”</em>. (Checking off Gym routine tasks like “Gym
        session” lives in Now and Week — this page is for what you actually lifted.)
      </p>
      {[...byDate.entries()].map(([date, entries]) => (
        <section key={date} className="gym-day">
          <h2>{date}{entries[0].split_day ? ` — ${entries[0].split_day}` : ''}</h2>
          {entries.map((log) => (
            <div key={log.id} className="gym-entry">
              <span className="gym-exercise">{log.exercise}</span>
              <span className="gym-sets">
                {log.sets?.map((s) => `${s.kg}kg×${s.reps}`).join('  ') ?? ''}
              </span>
              {log.notes && <span className="gym-notes">{log.notes}</span>}
            </div>
          ))}
        </section>
      ))}
      {logs.length === 0 && <p className="gentle">No sessions logged yet.</p>}
    </div>
  )
}
