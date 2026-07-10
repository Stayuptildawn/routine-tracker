import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { phaseKey, recoveryAdjustments, setCount, startBlock } from '../lib/blocks'
import { seedWorkoutTemplate } from '../lib/workoutTemplate'
import { DEFAULT_BASE_KM } from '../lib/cardioPlan'
import Session from './Session'
import GymCardio from './GymCardio'
import PlanEditor, { MUSCLE_GROUPS, composeScheme } from './PlanEditor'
import type { BlockApplyDiff } from './PlanEditor'
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

export default function Gym({ visible }: { visible: boolean }) {
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [block, setBlock] = useState<TrainingBlock | null>(null)
  const [sessions, setSessions] = useState<PlannedSession[]>([])
  const [loggedSets, setLoggedSets] = useState<{ muscle_group: string | null; session_id: string; logged_reps: number | null }[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  const [overLine, setOverLine] = useState<string[]>([]) // muscles flagged 2+ times recently
  const [nextTweaks, setNextTweaks] = useState<string | null>(null) // wrap-up preview
  const [active, setActive] = useState<PlannedSession | null>(null)
  const [planBlock, setPlanBlock] = useState(1) // which block the plan card shows
  const [editingPlan, setEditingPlan] = useState(false)
  const [cardioBase, setCardioBase] = useState<number | null>(null) // null=loading
  // always opens on Strength - the primary view - rather than remembering
  // whichever was open last
  const [view, setView] = useState<'strength' | 'cardio'>('strength')

  const [scratch, setScratch] = useState({ session: '', exercise: '', muscle: 'Other', sets: '3', reps: '10-12' })
  const [settingUp, setSettingUp] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState<number | null>(null) // which block's start is awaiting a yes
  const [blockApply, setBlockApply] = useState<BlockApplyDiff | null>(null) // saved plan changes awaiting "this block too?"
  const [applying, setApplying] = useState(false)

  // load() consults these so a background refresh never overwrites what the
  // user is looking at (or editing)
  const selectionInit = useRef(false)
  const planBlockRef = useRef(1)
  const splitRef = useRef<string | null>(null)
  const editingRef = useRef(false)
  const [split, setSplit] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)
  planBlockRef.current = planBlock
  splitRef.current = split
  editingRef.current = editingPlan

  const load = useCallback(async () => {
    const [logsRes, plansRes, settingsRes, firstRes, blockRes, cardioAllRes] = await Promise.all([
      supabase.from('workout_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('workout_plans').select('*').order('sort_order'),
      supabase.from('user_settings').select('program_start, cardio_target_km').maybeSingle(),
      supabase.from('workout_logs').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('training_blocks').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('cardio_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
    ])
    setCardio((cardioAllRes.data as CardioLog[]) ?? [])
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
      const [setsRes, checkinRes] = await Promise.all([
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
      ])
      setLoggedSets(setsRes.data ?? [])
      const counts = new Map<string, number>()
      for (const c of checkinRes.data ?? []) counts.set(c.muscle_group, (counts.get(c.muscle_group) ?? 0) + 1)
      setOverLine(
        [...counts.entries()]
          .filter(([mg, n]) => n >= 2 && !localStorage.getItem(`vol-sugg-${mg}`))
          .map(([mg]) => mg),
      )
    }
    // plan card follows the active block on FIRST load only - after that the
    // user's picks stick, so a refresh mid-edit never yanks the tab away
    const shownBlock = blockRow?.block ?? Math.max(1, ...planRows.map((p) => p.block))
    const keepBlock =
      selectionInit.current && planRows.some((p) => p.block === planBlockRef.current)
        ? planBlockRef.current
        : shownBlock
    setPlanBlock(keepBlock)
    const rotation = [...new Set(planRows.filter((p) => p.block === keepBlock).map((p) => p.split_day))]
    const prevSplit = splitRef.current
    if (!(selectionInit.current && prevSplit && (rotation.includes(prevSplit) || editingRef.current))) {
      // default to the split after the last logged one, in plan rotation order
      const lastSplit = logRows.find((l) => l.split_day)?.split_day
      const nextIdx = lastSplit ? (rotation.indexOf(lastSplit) + 1) % rotation.length : 0
      setSplit(rotation[nextIdx] ?? rotation[0] ?? null)
    }
    selectionInit.current = true
    // one clock: the active block's start wins; the picked program_start and
    // the first-ever log are fallbacks for block-less use
    const start = blockRow?.start_date ?? settingsRes.data?.program_start ?? firstRes.data?.date
    if (start) setWeek(weekFromStart(start))
    setCardioBase(settingsRes.data?.cardio_target_km ?? DEFAULT_BASE_KM)
    setLoaded(true)
  }, [])

  // refresh whenever the tab is shown - silent, the old data stays on screen
  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  async function beginBlock(blockNumber: number) {
    if (starting || plans.length === 0) return
    const adjustments = await recoveryAdjustments()
    setStarting(true)
    try {
      await startBlock(plans, blockNumber, adjustments)
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

  async function saveCardioBase(v: number) {
    setCardioBase(v)
    await supabase
      .from('user_settings')
      .upsert({ cardio_target_km: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }

  /** The "apply to this block too?" yes-branch: added exercises get sets
   *  appended to every not-yet-completed session of their split (right count
   *  for each week's phase); removed exercises lose their unlogged sets.
   *  Logged history is never touched and the week counter stays put. */
  async function applyToRunningBlock() {
    if (!blockApply || !block || applying) return
    setApplying(true)
    try {
      for (const r of blockApply.removed) {
        const ids = sessions.filter((s) => s.split_day === r.split_day).map((s) => s.id)
        if (ids.length > 0) {
          await supabase.from('planned_sets').delete().eq('exercise', r.exercise).is('logged_at', null).in('session_id', ids)
        }
      }
      if (blockApply.added.length > 0) {
        const targets = sessions.filter((s) => !s.completed_at)
        const { data: existing } = targets.length
          ? await supabase.from('planned_sets').select('session_id, sort_order').in('session_id', targets.map((s) => s.id))
          : { data: [] }
        const maxOrder = new Map<string, number>()
        for (const row of existing ?? []) maxOrder.set(row.session_id, Math.max(maxOrder.get(row.session_id) ?? 0, row.sort_order))
        const sets: Record<string, unknown>[] = []
        for (const a of blockApply.added) {
          for (const s of targets.filter((x) => x.split_day === a.split_day)) {
            const scheme = a.schemes?.[phaseKey(s.week_number)] ?? null
            const count = setCount(scheme)
            let order = maxOrder.get(s.id) ?? 0
            for (let n = 1; n <= count; n++) {
              sets.push({
                session_id: s.id,
                sort_order: ++order,
                exercise: a.exercise,
                muscle_group: a.muscle_group,
                set_number: n,
                target_scheme: scheme,
              })
            }
            maxOrder.set(s.id, order)
          }
        }
        for (let i = 0; i < sets.length; i += 200) {
          const { error } = await supabase.from('planned_sets').insert(sets.slice(i, i + 200))
          if (error) throw error
        }
      }
      setBlockApply(null)
      load()
    } finally {
      setApplying(false)
    }
  }

  async function useTemplate() {
    if (settingUp) return
    setSettingUp(true)
    try {
      await seedWorkoutTemplate()
      await load()
    } finally {
      setSettingUp(false)
    }
  }

  async function createOwnPlan() {
    const session = scratch.session.trim()
    const exercise = scratch.exercise.trim()
    if (settingUp || !session || !exercise) return
    setSettingUp(true)
    try {
      const scheme = composeScheme(scratch.sets, scratch.reps) || '3 x 10-12'
      await supabase.from('workout_plans').insert({
        block: 1,
        split_day: session,
        sort_order: 1,
        exercise,
        muscle_group: scratch.muscle,
        schemes: { '1-2': scheme, '3-4': scheme, '5-6': scheme },
      })
      await load()
      setSplit(session)
      setEditingPlan(true)
    } finally {
      setSettingUp(false)
    }
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
  }


  const byDate = new Map<string, WorkoutLog[]>()
  for (const log of logs) {
    const list = byDate.get(log.date) ?? []
    list.push(log)
    byDate.set(log.date, list)
  }

  // the block is "wrapped" when every session is handled or its weeks have run out
  const doneSessionCount = sessions.filter((s) => s.completed_at).length
  const blockDone =
    !!block &&
    sessions.length > 0 &&
    (doneSessionCount === sessions.length || weekFromStart(block.start_date) > block.total_weeks)
  const nextBlockNumber = block && plans.some((p) => p.block === block.block + 1) ? block.block + 1 : block?.block ?? 1

  useEffect(() => {
    if (!blockDone) return
    recoveryAdjustments().then((a) =>
      setNextTweaks([...a.entries()].map(([m, d]) => `${m} ${d > 0 ? '+1' : '−1'} set`).join(' · ')),
    )
  }, [blockDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const blockPlans = plans.filter((p) => p.block === planBlock)
  const availableBlocks = [...new Set(plans.map((p) => p.block))].sort()
  const rotation = [...new Set(blockPlans.map((p) => p.split_day))]
  const splitPlans = blockPlans.filter((p) => p.split_day === split)
  const splitCardio = splitPlans.find((p) => p.cardio)?.cardio

  return (
    <div className="gym">
      <h1>Workout</h1>
      <div className="energy-row seg-row">
        <button
          className={view === 'strength' ? 'energy-btn active' : 'energy-btn'}
          aria-pressed={view === 'strength'}
          onClick={() => setView('strength')}
        >
          🏋️ Strength
        </button>
        <button
          className={view === 'cardio' ? 'energy-btn active' : 'energy-btn'}
          aria-pressed={view === 'cardio'}
          onClick={() => setView('cardio')}
        >
          🏃 Cardio
        </button>
      </div>
      {view === 'strength' && (
        <p className="gentle">
          Sets, weights, reps — logged in a session, or from the Now tab:{' '}
          <em>“bench 60kg 3x8, felt easy”</em>.
        </p>
      )}

      {view === 'strength' && block && sessions.length > 0 && (() => {
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
            {upNext && !blockDone && (
              <button className="start-session" onClick={() => setActive(upNext)}>
                ▶ {upNext.date && !upNext.completed_at ? 'Continue' : 'Start'} {upNext.split_day}
                <span className="routine-progress"> week {upNext.week_number}</span>
              </button>
            )}
          </section>
        )
      })()}

      {view === 'strength' && block && blockDone && (
        <section className="gym-day wrapup-card">
          <h2>
            {block.name} — wrapped
            <span className="routine-progress"> ✓</span>
          </h2>
          <p className="gentle">
            {doneSessionCount} of {sessions.length} sessions handled ·{' '}
            {loggedSets.filter((s) => s.logged_reps != null).length} hard sets logged.
            {doneSessionCount < sessions.length && ' Open sessions stay available in the grid above.'}
          </p>
          <p className="gentle">
            {nextTweaks
              ? `From your recovery check-ins: ${nextTweaks} — applied when the next block generates.`
              : 'Your check-ins read as “right” across the board — the next block keeps the written volumes.'}
          </p>
          {confirmBlock === nextBlockNumber ? (
            <>
              <button
                className="start-session"
                onClick={() => {
                  setConfirmBlock(null)
                  beginBlock(nextBlockNumber)
                }}
                disabled={starting}
              >
                {starting ? 'Generating…' : `Yes — generate Block ${nextBlockNumber}: 6 weeks of sessions and sets`}
              </button>
              <button className="link" onClick={() => setConfirmBlock(null)}>
                Cancel
              </button>
            </>
          ) : (
            <button className="start-session" onClick={() => setConfirmBlock(nextBlockNumber)} disabled={starting}>
              {starting
                ? 'Generating…'
                : `▶ Start Block ${nextBlockNumber}${nextBlockNumber === 2 ? ' — Upper/Lower' : ''}${nextBlockNumber === (block.block ?? 1) ? ' (repeat)' : ''}, recovery-informed`}
            </button>
          )}
        </section>
      )}

      {view === 'strength' && loaded && blockPlans.length > 0 && (!block || block.block !== planBlock) && (
        confirmBlock === planBlock ? (
          <div className="start-block-confirm">
            {block && !sessions.every((s) => s.completed_at) && (
              <p className="gentle">
                The current {block.name} isn't finished — the new block becomes the active one (nothing is deleted).
              </p>
            )}
            <button
              className="start-session lone"
              onClick={() => {
                setConfirmBlock(null)
                beginBlock(planBlock)
              }}
              disabled={starting}
            >
              {starting ? 'Generating…' : `Yes — generate Block ${planBlock}: 6 weeks of sessions and sets`}
            </button>
            <button className="link" onClick={() => setConfirmBlock(null)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="start-session lone" onClick={() => setConfirmBlock(planBlock)} disabled={starting}>
            {starting ? 'Generating…' : `▶ Start Block ${planBlock} (6 weeks from the plan)`}
          </button>
        )
      )}

      {view === 'cardio' && loaded && (
        <GymCardio
          cardio={cardio}
          setCardio={setCardio}
          week={week}
          cardioBase={cardioBase}
          onSaveBase={saveCardioBase}
          reload={load}
        />
      )}

      {view === 'strength' && overLine.map((mg) => (
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

      {view === 'strength' && block && volume.size > 0 && (
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
                  <div className="volume-head">
                    <span className="volume-label">{mg}</span>
                    <span className="volume-avg">{avg} avg</span>
                  </div>
                  <div className="volume-bars">
                    {weeks.map((n, i) => {
                      const state = i + 1 === currentWeek ? 'now' : i + 1 > currentWeek ? 'future' : ''
                      return (
                        <div key={i} className="volume-col" title={`week ${i + 1}: ${n} sets`}>
                          <span className={`volume-count ${state}`}>{n}</span>
                          <div className="volume-bar-wrap">
                            <div className={`volume-bar ${state}`} style={{ height: `${(n / max) * 100}%` }} />
                          </div>
                          <span className={`volume-date ${state}`}>{i + 1}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {view === 'strength' && loaded && plans.length === 0 && (
        <section className="gym-day setup-card">
          <h2>Set up your training</h2>
          <p className="gentle">Two ways to begin — everything stays editable either way.</p>
          <button className="start-session" onClick={useTemplate} disabled={settingUp}>
            {settingUp ? 'Setting up…' : '▶ Use the starter plan'}
          </button>
          <p className="gentle">
            A joint-friendly 6-week Push/Pull/Legs block plus an Upper/Lower follow-up — machines,
            dumbbells and cables only, with an injury-safe cue on every exercise.
          </p>
          <p className="gentle setup-or">— or build your own —</p>
          <div className="add-task">
            <input
              placeholder="First session name (e.g. Upper A)"
              value={scratch.session}
              onChange={(e) => setScratch({ ...scratch, session: e.target.value })}
            />
          </div>
          <div className="add-task">
            <input
              placeholder="First exercise"
              value={scratch.exercise}
              onChange={(e) => setScratch({ ...scratch, exercise: e.target.value })}
            />
            <select value={scratch.muscle} onChange={(e) => setScratch({ ...scratch, muscle: e.target.value })}>
              {MUSCLE_GROUPS.map((m) => (
                <option key={m}>{m}</option>
              ))}
            </select>
          </div>
          <div className="add-task scheme-field">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={10}
              value={scratch.sets}
              onChange={(e) => setScratch({ ...scratch, sets: e.target.value })}
            />
            <span className="scheme-x">sets ×</span>
            <input
              placeholder="reps, e.g. 10-12"
              value={scratch.reps}
              onChange={(e) => setScratch({ ...scratch, reps: e.target.value })}
            />
          </div>
          <button
            className="start-session"
            onClick={createOwnPlan}
            disabled={settingUp || !scratch.session.trim() || !scratch.exercise.trim()}
          >
            {settingUp ? '…' : 'Create my plan'}
          </button>
          <p className="gentle">You can add more sessions and exercises right after.</p>
        </section>
      )}

      {view === 'strength' && plans.length > 0 && (
        <section className="gym-day plan-card">
          <div className="routine-header">
            <h2>
              The plan
              <span className="routine-progress">{phase ? ` ${phase.name}` : week !== null && week > 6 ? ' deload / Block 2 soon' : ''}</span>
            </h2>
            {!editingPlan && (
              <button className="link" onClick={() => setEditingPlan(true)}>
                Edit
              </button>
            )}
          </div>
          {availableBlocks.length > 1 && (
            <div className="energy-row plan-row">
              {availableBlocks.map((b) => (
                <button
                  key={b}
                  className={b === planBlock ? 'energy-btn active' : 'energy-btn'}
                  disabled={editingPlan}
                  title={editingPlan ? 'Save or cancel the edit first' : undefined}
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
          {!block && (
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
          )}
          {!editingPlan && (
            <div className="energy-row plan-row">
              <span className="energy-label">Session</span>
              {(split && !rotation.includes(split) ? [...rotation, split] : rotation).map((s) => (
                <button key={s} className={s === split ? 'energy-btn active' : 'energy-btn'} onClick={() => setSplit(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}
          {!editingPlan &&
            splitPlans.map((p) => (
              <div key={p.id} className="gym-entry">
                <span className="gym-exercise">{p.exercise}</span>
                <span className="gym-sets">{(phase && p.schemes?.[phase.key]) ?? p.schemes?.['1-2'] ?? ''}</span>
                {p.safety_note && <span className="gym-notes">🛡 {p.safety_note}</span>}
              </div>
            ))}
          {editingPlan && (
            <PlanEditor
              origin={blockPlans}
              planBlock={planBlock}
              activeBlock={block}
              sessions={sessions}
              initialSplit={split}
              onCancel={() => setEditingPlan(false)}
              onSaved={(editSplit, diff) => {
                setEditingPlan(false)
                if (editSplit) setSplit(editSplit)
                if (diff) setBlockApply(diff)
                load()
              }}
            />
          )}
          {splitCardio && !editingPlan && <p className="gentle plan-cardio">Cardio: {splitCardio}</p>}
        </section>
      )}

      {view === 'strength' && blockApply && block && (
        <div className="notice vol-suggestion block-apply">
          <span>
            {[
              blockApply.added.length > 0 ? `Added: ${blockApply.added.map((a) => a.exercise).join(', ')}` : null,
              blockApply.removed.length > 0 ? `Removed: ${blockApply.removed.map((r) => r.exercise).join(', ')}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            {' — '}put this into {block.name}'s remaining sessions too, or only from the next block?
          </span>
          <button className="link" onClick={applyToRunningBlock} disabled={applying}>
            {applying ? 'Applying…' : 'Apply to this block'}
          </button>
          <button className="link" onClick={() => setBlockApply(null)} disabled={applying}>
            Next block only
          </button>
        </div>
      )}

      {view === 'strength' &&
        [...byDate.entries()].map(([date, entries]) => (
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
          </section>
        ))}
      {!loaded && <Skeleton cards={2} />}
      {view === 'strength' && loaded && logs.length === 0 && <p className="gentle">No freeform lifts logged yet.</p>}

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
