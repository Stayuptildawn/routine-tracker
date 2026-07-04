import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { WorkoutLog, WorkoutPlan } from '../lib/types'
import Skeleton from '../components/Skeleton'

const PHASES: { key: string; name: string; maxWeek: number }[] = [
  { key: '1-2', name: 'Accumulation', maxWeek: 2 },
  { key: '3-4', name: 'Intensification', maxWeek: 4 },
  { key: '5-6', name: 'Realization', maxWeek: 6 },
]

export default function Gym() {
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [split, setSplit] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('workout_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('workout_plans').select('*').order('sort_order'),
      supabase.from('workout_logs').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
    ]).then(([logsRes, plansRes, firstRes]) => {
      const logRows = (logsRes.data as WorkoutLog[]) ?? []
      const planRows = (plansRes.data as WorkoutPlan[]) ?? []
      setLogs(logRows)
      setPlans(planRows)
      // default to the split after the last logged one, in plan rotation order
      const rotation = [...new Set(planRows.map((p) => p.split_day))]
      const lastSplit = logRows.find((l) => l.split_day)?.split_day
      const nextIdx = lastSplit ? (rotation.indexOf(lastSplit) + 1) % rotation.length : 0
      setSplit(rotation[nextIdx] ?? null)
      // week number derives from the first ever log
      if (firstRes.data) {
        const days = (new Date(localDate() + 'T00:00:00').getTime() - new Date(firstRes.data.date + 'T00:00:00').getTime()) / 86400000
        setWeek(Math.floor(days / 7) + 1)
      }
      setLoaded(true)
    })
  }, [])

  const phase = week === null ? null : PHASES.find((p) => week <= p.maxWeek) ?? null

  const byDate = new Map<string, WorkoutLog[]>()
  for (const log of logs) {
    const list = byDate.get(log.date) ?? []
    list.push(log)
    byDate.set(log.date, list)
  }

  const rotation = [...new Set(plans.map((p) => p.split_day))]
  const splitPlans = plans.filter((p) => p.split_day === split)
  const cardio = splitPlans.find((p) => p.cardio)?.cardio

  return (
    <div className="gym">
      <h1>Workout log</h1>
      <p className="gentle">
        This is your exercise logbook — sets, weights, reps. Log from the Now tab:{' '}
        <em>“bench 60kg 3x8, felt easy”</em>. (Checking off Gym routine tasks like “Gym
        session” lives in Now and Week — this page is for what you actually lifted.)
      </p>

      {plans.length > 0 && (
        <section className="gym-day plan-card">
          <h2>
            The plan
            <span className="routine-progress">
              {week !== null && ` week ${week}`}
              {phase && ` · ${phase.name}`}
              {week !== null && week > 6 && ' · deload / Block 2 soon'}
            </span>
          </h2>
          <div className="chips plan-chips">
            {rotation.map((s) => (
              <button key={s} className={s === split ? 'chip active' : 'chip'} onClick={() => setSplit(s)}>
                {s}
              </button>
            ))}
          </div>
          {splitPlans.map((p) => (
            <div key={p.id} className="gym-entry">
              <span className="gym-exercise">{p.exercise}</span>
              <span className="gym-sets">{(phase && p.schemes?.[phase.key]) ?? p.schemes?.['1-2'] ?? ''}</span>
              {p.safety_note && <span className="gym-notes">🛡 {p.safety_note}</span>}
            </div>
          ))}
          {cardio && <p className="gentle plan-cardio">Cardio: {cardio}</p>}
        </section>
      )}

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
      {!loaded && <Skeleton cards={2} />}
      {loaded && logs.length === 0 && <p className="gentle">No sessions logged yet.</p>}
    </div>
  )
}
