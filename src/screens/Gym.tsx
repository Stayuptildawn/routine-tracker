import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { startBlock } from '../lib/blocks'
import Session from './Session'
import Skeleton from '../components/Skeleton'

const PHASES: { key: string; name: string; maxWeek: number }[] = [
  { key: '1-2', name: 'Accumulation', maxWeek: 2 },
  { key: '3-4', name: 'Intensification', maxWeek: 4 },
  { key: '5-6', name: 'Realization', maxWeek: 6 },
]

/** Monday of the week containing `date`, minus (week-1) weeks. */
function programStartForWeek(week: number): string {
  const d = new Date()
  d.setDate(d.getDate() - (isoWeekday() - 1) - (week - 1) * 7)
  return localDate(d)
}

function weekFromStart(start: string): number {
  const days = (new Date(localDate() + 'T00:00:00').getTime() - new Date(start + 'T00:00:00').getTime()) / 86400000
  return Math.max(1, Math.floor(days / 7) + 1)
}

export default function Gym() {
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [block, setBlock] = useState<TrainingBlock | null>(null)
  const [sessions, setSessions] = useState<PlannedSession[]>([])
  const [active, setActive] = useState<PlannedSession | null>(null)
  const [starting, setStarting] = useState(false)
  const [split, setSplit] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [logsRes, plansRes, settingsRes, firstRes, blockRes] = await Promise.all([
      supabase.from('workout_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('workout_plans').select('*').order('sort_order'),
      supabase.from('user_settings').select('program_start').maybeSingle(),
      supabase.from('workout_logs').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('training_blocks').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ])
    const logRows = (logsRes.data as WorkoutLog[]) ?? []
    const planRows = (plansRes.data as WorkoutPlan[]) ?? []
    setLogs(logRows)
    setPlans(planRows)
    const blockRow = blockRes.data as TrainingBlock | null
    setBlock(blockRow)
    if (blockRow) {
      const { data: sess } = await supabase
        .from('planned_sessions')
        .select('*')
        .eq('block_id', blockRow.id)
        .order('week_number')
        .order('day_number')
      setSessions((sess as PlannedSession[]) ?? [])
    }
    // default to the split after the last logged one, in plan rotation order
    const rotation = [...new Set(planRows.map((p) => p.split_day))]
    const lastSplit = logRows.find((l) => l.split_day)?.split_day
    const nextIdx = lastSplit ? (rotation.indexOf(lastSplit) + 1) % rotation.length : 0
    setSplit(rotation[nextIdx] ?? null)
    // week: the picked program_start wins; first-ever log is the fallback
    const start = settingsRes.data?.program_start ?? firstRes.data?.date
    if (start) setWeek(weekFromStart(start))
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function beginBlock() {
    if (starting || plans.length === 0) return
    if (!window.confirm('Generate Block 1: 6 weeks of sessions and sets from the plan?')) return
    setStarting(true)
    try {
      await startBlock(plans, 1)
      // keep the plan card's week picker in sync with the block
      await supabase
        .from('user_settings')
        .upsert({ program_start: programStartForWeek(1), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      await load()
    } finally {
      setStarting(false)
    }
  }

  async function pickWeek(w: number) {
    setWeek(w)
    await supabase
      .from('user_settings')
      .upsert({ program_start: programStartForWeek(w), updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }

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

      {block && sessions.length > 0 && (() => {
        const blockWeek = Math.min(weekFromStart(block.start_date), block.total_weeks)
        const thisWeek = sessions.filter((s) => s.week_number === blockWeek)
        const upNext = sessions.find((s) => !s.completed_at)
        return (
          <section className="gym-day block-card">
            <h2>
              {block.name}
              <span className="routine-progress">
                week {blockWeek} of {block.total_weeks}
              </span>
            </h2>
            <div className="energy-row plan-row">
              {thisWeek.map((s) => (
                <button
                  key={s.id}
                  className={s.completed_at ? 'energy-btn session-done' : upNext?.id === s.id ? 'energy-btn active' : 'energy-btn'}
                  onClick={() => setActive(s)}
                >
                  {s.completed_at ? '✓ ' : ''}
                  {s.split_day}
                </button>
              ))}
            </div>
            {upNext && (
              <button className="start-session" onClick={() => setActive(upNext)}>
                ▶ {upNext.date && !upNext.completed_at ? 'Continue' : 'Start'} {upNext.split_day}
                <span className="routine-progress"> week {upNext.week_number}</span>
              </button>
            )}
            {!upNext && <p className="gentle">Block complete. Whenever you’re ready for the next one.</p>}
          </section>
        )
      })()}

      {plans.length > 0 && !block && loaded && (
        <button className="start-session lone" onClick={beginBlock} disabled={starting}>
          {starting ? 'Generating…' : '▶ Start Block 1 (6 weeks from the plan)'}
        </button>
      )}

      {plans.length > 0 && (
        <section className="gym-day plan-card">
          <h2>
            The plan
            <span className="routine-progress">{phase ? ` ${phase.name}` : week !== null && week > 6 ? ' deload / Block 2 soon' : ''}</span>
          </h2>
          <div className="energy-row plan-row">
            <span className="energy-label">Week</span>
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <button
                key={w}
                className={week === w || (w === 7 && week !== null && week > 6) ? 'energy-btn active' : 'energy-btn'}
                onClick={() => pickWeek(w)}
              >
                {w === 7 ? '7+' : w}
              </button>
            ))}
          </div>
          <div className="energy-row plan-row">
            <span className="energy-label">Session</span>
            {rotation.map((s) => (
              <button key={s} className={s === split ? 'energy-btn active' : 'energy-btn'} onClick={() => setSplit(s)}>
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

      {active && (
        <Session
          session={active}
          plans={plans}
          onExit={() => {
            setActive(null)
            load()
          }}
        />
      )}
    </div>
  )
}
