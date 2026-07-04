import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { startBlock } from '../lib/blocks'
import Session from './Session'
import Skeleton from '../components/Skeleton'

const MUSCLE_GROUPS = ['Chest', 'Shoulders', 'Triceps', 'Back', 'Biceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Other']
const PHASE_KEYS = ['1-2', '3-4', '5-6']

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
  const [loggedSets, setLoggedSets] = useState<{ muscle_group: string | null; session_id: string; logged_reps: number | null }[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  const [overLine, setOverLine] = useState<string[]>([]) // muscles flagged 2+ times recently
  const [active, setActive] = useState<PlannedSession | null>(null)
  const [planBlock, setPlanBlock] = useState(1) // which block the plan card shows
  const [editingPlan, setEditingPlan] = useState(false)
  const [newEx, setNewEx] = useState({ name: '', muscle: 'Other', scheme: '3 x 10-12' })
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
      const sessRows = (sess as PlannedSession[]) ?? []
      setSessions(sessRows)
      const [setsRes, checkinRes, cardioRes] = await Promise.all([
        supabase
          .from('planned_sets')
          .select('muscle_group, session_id, logged_reps')
          .in('session_id', sessRows.map((s) => s.id))
          .not('logged_at', 'is', null),
        supabase
          .from('recovery_checkins')
          .select('muscle_group, amount')
          .eq('amount', 'over_the_line')
          .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()),
        supabase.from('cardio_logs').select('*').order('date', { ascending: false }).limit(100),
      ])
      setLoggedSets(setsRes.data ?? [])
      setCardio((cardioRes.data as CardioLog[]) ?? [])
      const counts = new Map<string, number>()
      for (const c of checkinRes.data ?? []) counts.set(c.muscle_group, (counts.get(c.muscle_group) ?? 0) + 1)
      setOverLine(
        [...counts.entries()]
          .filter(([mg, n]) => n >= 2 && !localStorage.getItem(`vol-sugg-${mg}`))
          .map(([mg]) => mg),
      )
    }
    // plan card follows the active block; falls back to the highest seeded one
    const shownBlock = blockRow?.block ?? Math.max(1, ...planRows.map((p) => p.block))
    setPlanBlock(shownBlock)
    // default to the split after the last logged one, in plan rotation order
    const rotation = [...new Set(planRows.filter((p) => p.block === shownBlock).map((p) => p.split_day))]
    const lastSplit = logRows.find((l) => l.split_day)?.split_day
    const nextIdx = lastSplit ? (rotation.indexOf(lastSplit) + 1) % rotation.length : 0
    setSplit(rotation[nextIdx] ?? rotation[0] ?? null)
    // week: the picked program_start wins; first-ever log is the fallback
    const start = settingsRes.data?.program_start ?? firstRes.data?.date
    if (start) setWeek(weekFromStart(start))
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function beginBlock(blockNumber: number) {
    if (starting || plans.length === 0) return
    const warning = block && !sessions.every((s) => s.completed_at)
      ? ` The current ${block.name} isn't finished — the new block becomes the active one (nothing is deleted).`
      : ''
    if (!window.confirm(`Generate Block ${blockNumber}: 6 weeks of sessions and sets from the plan?${warning}`)) return
    setStarting(true)
    try {
      await startBlock(plans, blockNumber)
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

  async function updatePlan(id: string, patch: Partial<WorkoutPlan>) {
    await supabase.from('workout_plans').update(patch).eq('id', id)
    load()
  }

  async function movePlan(p: WorkoutPlan, dir: -1 | 1) {
    const list = plans.filter((x) => x.split_day === p.split_day && x.block === p.block)
    const other = list[list.indexOf(p) + dir]
    if (!other) return
    await Promise.all([
      supabase.from('workout_plans').update({ sort_order: other.sort_order }).eq('id', p.id),
      supabase.from('workout_plans').update({ sort_order: p.sort_order }).eq('id', other.id),
    ])
    load()
  }

  async function deletePlan(p: WorkoutPlan) {
    if (!window.confirm(`Remove "${p.exercise}" from the plan? (Already-generated sessions keep it.)`)) return
    await supabase.from('workout_plans').delete().eq('id', p.id)
    load()
  }

  async function addPlan() {
    const name = newEx.name.trim()
    if (!name || !split) return
    const maxOrder = Math.max(0, ...plans.map((p) => p.sort_order ?? 0))
    await supabase.from('workout_plans').insert({
      block: planBlock,
      split_day: split,
      sort_order: maxOrder + 1,
      exercise: name,
      muscle_group: newEx.muscle,
      schemes: { '1-2': newEx.scheme, '3-4': newEx.scheme, '5-6': newEx.scheme },
    })
    setNewEx({ ...newEx, name: '' })
    load()
  }

  const phase = week === null ? null : PHASES.find((p) => week <= p.maxWeek) ?? null

  // volume picture: hard sets (reps actually logged) per muscle per week
  const weekBySession = new Map(sessions.map((s) => [s.id, s.week_number]))
  const volume = new Map<string, number[]>()
  if (block) {
    for (const s of loggedSets) {
      if (s.logged_reps == null || !s.muscle_group) continue
      const wk = weekBySession.get(s.session_id)
      if (!wk) continue
      const arr = volume.get(s.muscle_group) ?? Array(block.total_weeks).fill(0)
      arr[wk - 1]++
      volume.set(s.muscle_group, arr)
    }
    // cardio joins the picture as minutes per week
    const cardioWeeks = Array(block.total_weeks).fill(0)
    let anyCardio = false
    for (const c of cardio) {
      const wk = c.session_id
        ? weekBySession.get(c.session_id)
        : Math.floor((new Date(c.date + 'T00:00:00').getTime() - new Date(block.start_date + 'T00:00:00').getTime()) / (7 * 86400000)) + 1
      if (!wk || wk < 1 || wk > block.total_weeks || !c.minutes) continue
      cardioWeeks[wk - 1] += Number(c.minutes)
      anyCardio = true
    }
    if (anyCardio) volume.set('Cardio (min)', cardioWeeks)
  }

  const cardioByDate = new Map<string, CardioLog[]>()
  for (const c of cardio) {
    const list = cardioByDate.get(c.date) ?? []
    list.push(c)
    cardioByDate.set(c.date, list)
  }

  const byDate = new Map<string, WorkoutLog[]>()
  for (const log of logs) {
    const list = byDate.get(log.date) ?? []
    list.push(log)
    byDate.set(log.date, list)
  }

  const blockPlans = plans.filter((p) => p.block === planBlock)
  const availableBlocks = [...new Set(plans.map((p) => p.block))].sort()
  const rotation = [...new Set(blockPlans.map((p) => p.split_day))]
  const splitPlans = blockPlans.filter((p) => p.split_day === split)
  const splitCardio = splitPlans.find((p) => p.cardio)?.cardio

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
        const upNext = sessions.find((s) => !s.completed_at)
        const weeks = Array.from({ length: block.total_weeks }, (_, i) => i + 1)
        const dayRows = sessions.filter((s) => s.week_number === 1)
        return (
          <section className="gym-day block-card">
            <h2>
              {block.name}
              <span className="routine-progress">
                week {blockWeek} of {block.total_weeks}
              </span>
            </h2>
            <div className="weeks-grid" role="grid" aria-label="block sessions">
              <div className="weeks-row weeks-head">
                <span className="weeks-label"></span>
                {weeks.map((w) => (
                  <span key={w} className={w === blockWeek ? 'weeks-num now' : 'weeks-num'}>
                    {w}
                  </span>
                ))}
              </div>
              {dayRows.map((day) => (
                <div key={day.day_number} className="weeks-row">
                  <span className="weeks-label">{day.split_day}</span>
                  {weeks.map((w) => {
                    const s = sessions.find((x) => x.week_number === w && x.day_number === day.day_number)
                    if (!s) return <span key={w} className="weeks-cell empty" />
                    const cls = s.completed_at
                      ? 'weeks-cell done'
                      : upNext?.id === s.id
                        ? 'weeks-cell next'
                        : 'weeks-cell'
                    return (
                      <button
                        key={w}
                        className={cls}
                        title={`${s.split_day} — week ${w}${s.completed_at ? ' ✓' : ''}`}
                        onClick={() => setActive(s)}
                      >
                        {s.completed_at ? '✓' : ''}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <p className="gentle">Tap any cell to open that session — past weeks can be filled in late.</p>
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

      {loaded && blockPlans.length > 0 && (!block || block.block !== planBlock) && (
        <button className="start-session lone" onClick={() => beginBlock(planBlock)} disabled={starting}>
          {starting ? 'Generating…' : `▶ Start Block ${planBlock} (6 weeks from the plan)`}
        </button>
      )}

      {overLine.map((mg) => (
        <div key={mg} className="notice vol-suggestion">
          {mg} has said “over the line” a couple of times lately — want one set fewer next week? (Edit the plan
          below; the current week stays as planned.)
          <button
            className="link"
            onClick={() => {
              localStorage.setItem(`vol-sugg-${mg}`, '1')
              setOverLine(overLine.filter((m) => m !== mg))
            }}
          >
            ✕
          </button>
        </div>
      ))}

      {block && volume.size > 0 && (
        <section className="gym-day volume-card">
          <h2>
            Volume picture
            <span className="routine-progress">hard sets per week</span>
          </h2>
          <div className="volume-grid">
            {[...volume.entries()].map(([mg, weeks]) => {
              const max = Math.max(1, ...weeks)
              const currentWeek = Math.min(weekFromStart(block.start_date), block.total_weeks)
              const past = weeks.slice(0, currentWeek)
              const avg = past.length ? Math.round((past.reduce((a, b) => a + b, 0) / past.length) * 10) / 10 : 0
              return (
                <div key={mg} className="volume-muscle">
                  <span className="volume-label">{mg}</span>
                  <div className="volume-bars">
                    {weeks.map((n, i) => (
                      <div key={i} className="volume-bar-wrap" title={`week ${i + 1}: ${n}`}>
                        <div
                          className={i + 1 === currentWeek ? 'volume-bar now' : i + 1 > currentWeek ? 'volume-bar future' : 'volume-bar'}
                          style={{ height: `${(n / max) * 100}%` }}
                        />
                      </div>
                    ))}
                  </div>
                  <span className="volume-avg">{avg} avg</span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {plans.length > 0 && (
        <section className="gym-day plan-card">
          <div className="routine-header">
            <h2>
              The plan
              <span className="routine-progress">{phase ? ` ${phase.name}` : week !== null && week > 6 ? ' deload / Block 2 soon' : ''}</span>
            </h2>
            <button className="link" onClick={() => setEditingPlan(!editingPlan)}>
              {editingPlan ? 'Done' : 'Edit'}
            </button>
          </div>
          {availableBlocks.length > 1 && (
            <div className="energy-row plan-row">
              {availableBlocks.map((b) => (
                <button
                  key={b}
                  className={b === planBlock ? 'energy-btn active' : 'energy-btn'}
                  onClick={() => {
                    setPlanBlock(b)
                    const firstSplit = plans.find((p) => p.block === b)?.split_day ?? null
                    setSplit(firstSplit)
                  }}
                >
                  Block {b}
                </button>
              ))}
            </div>
          )}
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
          {!editingPlan &&
            splitPlans.map((p) => (
              <div key={p.id} className="gym-entry">
                <span className="gym-exercise">{p.exercise}</span>
                <span className="gym-sets">{(phase && p.schemes?.[phase.key]) ?? p.schemes?.['1-2'] ?? ''}</span>
                {p.safety_note && <span className="gym-notes">🛡 {p.safety_note}</span>}
              </div>
            ))}
          {editingPlan && (
            <div className="edit-panel">
              <p className="gentle">Edits shape the next block — already-generated sessions stay as they are.</p>
              {splitPlans.map((p, i) => (
                <div key={p.id} className="edit-task">
                  <div className="edit-task-row">
                    <input
                      defaultValue={p.exercise}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== p.exercise) updatePlan(p.id, { exercise: v })
                      }}
                    />
                    <select
                      value={p.muscle_group ?? 'Other'}
                      onChange={(e) => updatePlan(p.id, { muscle_group: e.target.value })}
                    >
                      {MUSCLE_GROUPS.map((m) => (
                        <option key={m}>{m}</option>
                      ))}
                    </select>
                    <button className="danger" disabled={i === 0} onClick={() => movePlan(p, -1)}>
                      ↑
                    </button>
                    <button className="danger" disabled={i === splitPlans.length - 1} onClick={() => movePlan(p, 1)}>
                      ↓
                    </button>
                    <button className="danger" onClick={() => deletePlan(p)}>
                      ✕
                    </button>
                  </div>
                  <div className="edit-task-row scheme-row">
                    {PHASE_KEYS.map((k) => (
                      <input
                        key={k}
                        defaultValue={p.schemes?.[k] ?? ''}
                        placeholder={`wk ${k}`}
                        onBlur={(e) => {
                          const v = e.target.value.trim()
                          if (v !== (p.schemes?.[k] ?? '')) updatePlan(p.id, { schemes: { ...p.schemes, [k]: v } })
                        }}
                      />
                    ))}
                  </div>
                </div>
              ))}
              <div className="add-task">
                <input
                  value={newEx.name}
                  onChange={(e) => setNewEx({ ...newEx, name: e.target.value })}
                  onKeyDown={(e) => e.key === 'Enter' && addPlan()}
                  placeholder={`New exercise for ${split ?? '…'}`}
                />
                <select value={newEx.muscle} onChange={(e) => setNewEx({ ...newEx, muscle: e.target.value })}>
                  {MUSCLE_GROUPS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
                <button onClick={addPlan}>Add</button>
              </div>
            </div>
          )}
          {splitCardio && !editingPlan && <p className="gentle plan-cardio">Cardio: {splitCardio}</p>}
        </section>
      )}

      {[...new Set([...byDate.keys(), ...cardioByDate.keys()])]
        .sort()
        .reverse()
        .map((date) => {
          const entries = byDate.get(date) ?? []
          const cardioEntries = cardioByDate.get(date) ?? []
          return (
            <section key={date} className="gym-day">
              <h2>{date}{entries[0]?.split_day ? ` — ${entries[0].split_day}` : ''}</h2>
              {entries.map((log) => (
                <div key={log.id} className="gym-entry">
                  <span className="gym-exercise">{log.exercise}</span>
                  <span className="gym-sets">
                    {log.sets?.map((s) => `${s.kg}kg×${s.reps}`).join('  ') ?? ''}
                  </span>
                  {log.notes && <span className="gym-notes">{log.notes}</span>}
                </div>
              ))}
              {cardioEntries.map((c) => (
                <div key={c.id} className="gym-entry">
                  <span className="gym-exercise">🏃 {c.kind}</span>
                  <span className="gym-sets">
                    {c.distance_km ? `${c.distance_km}km ` : ''}
                    {c.minutes ? `${c.minutes} min` : ''}
                  </span>
                  {c.notes && <span className="gym-notes">{c.notes}</span>}
                </div>
              ))}
            </section>
          )
        })}
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
