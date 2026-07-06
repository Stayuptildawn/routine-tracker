import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { recoveryAdjustments, startBlock } from '../lib/blocks'
import { runOp } from '../lib/offline'
import { seedWorkoutTemplate } from '../lib/workoutTemplate'
import { DEFAULT_BASE_KM, cardioTargetForWeek } from '../lib/cardioPlan'
import Session from './Session'
import Skeleton from '../components/Skeleton'

const MUSCLE_GROUPS = ['Chest', 'Shoulders', 'Triceps', 'Back', 'Biceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Other']
const PHASE_KEYS = ['1-2', '3-4', '5-6']
const CARDIO_KINDS = [
  ['run', '🏃 Run'],
  ['walk', '🚶 Walk'],
  ['cycle', '🚴 Cycle'],
  ['swim', '🏊 Swim'],
] as const

// the strength check-in questions, adapted to cardio - saved per entry
const CARDIO_QUESTIONS: { field: 'effort' | 'body' | 'amount'; label: string; options: [string, string][] }[] = [
  {
    field: 'effort',
    label: 'How hard did it feel?',
    options: [
      ['easy', 'Easy'],
      ['steady', 'Steady'],
      ['pushed', 'Pushed'],
      ['all_out', 'All out'],
    ],
  },
  {
    field: 'body',
    label: 'How was the body?',
    options: [
      ['fresh', 'Fresh'],
      ['okay', 'Okay'],
      ['heavy', 'Heavy'],
    ],
  },
  {
    field: 'amount',
    label: 'How was the amount?',
    options: [
      ['could_take_more', 'Could take more'],
      ['right', 'Right'],
      ['stretch', 'A stretch'],
      ['over_the_line', 'Over the line'],
    ],
  },
]

/** minutes over km -> "6:24 /km" */
function fmtPace(minutes: number | null, km: number | null): string | null {
  if (!minutes || !km || km <= 0) return null
  const perKm = minutes / km
  const m = Math.floor(perKm)
  const s = Math.round((perKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

/** Monday (yyyy-mm-dd) of the week containing the given date string. */
function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDate(d)
}

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
  const [nextTweaks, setNextTweaks] = useState<string | null>(null) // wrap-up preview
  const [active, setActive] = useState<PlannedSession | null>(null)
  const [planBlock, setPlanBlock] = useState(1) // which block the plan card shows
  const [editingPlan, setEditingPlan] = useState(false)
  const [cardioBase, setCardioBase] = useState<number | null>(null) // null=loading
  const [baseDraft, setBaseDraft] = useState('')
  const [run, setRun] = useState({ kind: 'run', km: '', min: '' })
  const [loggingRun, setLoggingRun] = useState(false)
  const [view, setView] = useState<'strength' | 'cardio'>(
    () => (localStorage.getItem('gym-view') as 'strength' | 'cardio') ?? 'strength',
  )
  const [editCardio, setEditCardio] = useState<{ id: string; kind: string; km: string; min: string; notes: string } | null>(null)

  function pickView(v: 'strength' | 'cardio') {
    setView(v)
    localStorage.setItem('gym-view', v)
  }
  const [newEx, setNewEx] = useState({ name: '', muscle: 'Other', scheme: '3 x 10-12' })
  const [newSession, setNewSession] = useState('')
  const [scratch, setScratch] = useState({ session: '', exercise: '', muscle: 'Other', scheme: '3 x 10-12' })
  const [settingUp, setSettingUp] = useState(false)
  const [starting, setStarting] = useState(false)
  const [split, setSplit] = useState<string | null>(null)
  const [week, setWeek] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

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
    // plan card follows the active block; falls back to the highest seeded one
    const shownBlock = blockRow?.block ?? Math.max(1, ...planRows.map((p) => p.block))
    setPlanBlock(shownBlock)
    // default to the split after the last logged one, in plan rotation order
    const rotation = [...new Set(planRows.filter((p) => p.block === shownBlock).map((p) => p.split_day))]
    const lastSplit = logRows.find((l) => l.split_day)?.split_day
    const nextIdx = lastSplit ? (rotation.indexOf(lastSplit) + 1) % rotation.length : 0
    setSplit(rotation[nextIdx] ?? rotation[0] ?? null)
    // one clock: the active block's start wins; the picked program_start and
    // the first-ever log are fallbacks for block-less use
    const start = blockRow?.start_date ?? settingsRes.data?.program_start ?? firstRes.data?.date
    if (start) setWeek(weekFromStart(start))
    setCardioBase(settingsRes.data?.cardio_target_km ?? DEFAULT_BASE_KM)
    setBaseDraft(String(settingsRes.data?.cardio_target_km ?? DEFAULT_BASE_KM))
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function beginBlock(blockNumber: number) {
    if (starting || plans.length === 0) return
    const adjustments = await recoveryAdjustments()
    const tweaks = [...adjustments.entries()].map(([m, d]) => `${m} ${d > 0 ? '+1' : '−1'} set`).join(', ')
    const tweakNote = tweaks
      ? ` Your recovery check-ins suggest: ${tweaks} (applied per exercise, never below 2 sets).`
      : ''
    const warning = block && !sessions.every((s) => s.completed_at)
      ? ` The current ${block.name} isn't finished — the new block becomes the active one (nothing is deleted).`
      : ''
    if (!window.confirm(`Generate Block ${blockNumber}: 6 weeks of sessions and sets from the plan?${tweakNote}${warning}`)) return
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

  async function saveCardioBase() {
    const v = parseFloat(baseDraft)
    if (!Number.isFinite(v) || v <= 0) return
    setCardioBase(v)
    await supabase
      .from('user_settings')
      .upsert({ cardio_target_km: v, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }

  async function logRun() {
    const km = parseFloat(run.km)
    const min = parseFloat(run.min)
    if (loggingRun || (!Number.isFinite(km) && !Number.isFinite(min))) return
    setLoggingRun(true)
    try {
      // client-generated id: works identically online and queued-offline
      const entry: CardioLog = {
        id: crypto.randomUUID(),
        session_id: null,
        date: localDate(),
        kind: run.kind,
        distance_km: Number.isFinite(km) ? km : null,
        minutes: Number.isFinite(min) ? min : null,
        notes: null,
      }
      const result = await runOp({ table: 'cardio_logs', op: 'insert', values: entry as unknown as Record<string, unknown> })
      setRun({ ...run, km: '', min: '' })
      if (result === 'saved') await load()
      else setCardio((prev) => [entry, ...prev]) // optimistic while offline
      // offer the check-in right away - each pill saves on tap, closing skips
      setEditCardio({
        id: entry.id,
        kind: run.kind,
        km: Number.isFinite(km) ? String(km) : '',
        min: Number.isFinite(min) ? String(min) : '',
        notes: '',
      })
    } finally {
      setLoggingRun(false)
    }
  }

  async function setCardioFeel(id: string, field: 'effort' | 'body' | 'amount', value: string) {
    const current = cardio.find((c) => c.id === id)?.[field]
    const next = current === value ? null : value // tap again to unset
    setCardio((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: next } : c)))
    await runOp({ table: 'cardio_logs', op: 'update', ids: [id], values: { [field]: next } })
  }

  async function saveCardio() {
    if (!editCardio) return
    const km = parseFloat(editCardio.km)
    const min = parseFloat(editCardio.min)
    const values = {
      kind: editCardio.kind,
      distance_km: Number.isFinite(km) ? km : null,
      minutes: Number.isFinite(min) ? min : null,
      notes: editCardio.notes.trim() || null,
    }
    setCardio((prev) => prev.map((c) => (c.id === editCardio.id ? { ...c, ...values } : c)))
    setEditCardio(null)
    if ((await runOp({ table: 'cardio_logs', op: 'update', ids: [editCardio.id], values })) === 'saved') load()
  }

  async function deleteCardio(id: string) {
    if (!window.confirm('Remove this cardio entry?')) return
    await supabase.from('cardio_logs').delete().eq('id', id)
    setEditCardio(null)
    load()
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
      await supabase.from('workout_plans').insert({
        block: 1,
        split_day: session,
        sort_order: 1,
        exercise,
        muscle_group: scratch.muscle,
        schemes: { '1-2': scratch.scheme, '3-4': scratch.scheme, '5-6': scratch.scheme },
      })
      await load()
      setSplit(session)
      setEditingPlan(true)
    } finally {
      setSettingUp(false)
    }
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
        <button className={view === 'strength' ? 'energy-btn active' : 'energy-btn'} onClick={() => pickView('strength')}>
          🏋️ Strength
        </button>
        <button className={view === 'cardio' ? 'energy-btn active' : 'energy-btn'} onClick={() => pickView('cardio')}>
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
          <button className="start-session" onClick={() => beginBlock(nextBlockNumber)} disabled={starting}>
            {starting
              ? 'Generating…'
              : `▶ Start Block ${nextBlockNumber}${nextBlockNumber === 2 ? ' — Upper/Lower' : ''}${nextBlockNumber === (block.block ?? 1) ? ' (repeat)' : ''}, recovery-informed`}
          </button>
        </section>
      )}

      {view === 'strength' && loaded && blockPlans.length > 0 && (!block || block.block !== planBlock) && (
        <button className="start-session lone" onClick={() => beginBlock(planBlock)} disabled={starting}>
          {starting ? 'Generating…' : `▶ Start Block ${planBlock} (6 weeks from the plan)`}
        </button>
      )}

      {view === 'cardio' && loaded && (() => {
        const thisMonday = mondayOf(localDate())
        const thisWeek = cardio.filter((c) => mondayOf(c.date) === thisMonday)
        const weekKm = thisWeek.reduce((n, c) => n + Number(c.distance_km ?? 0), 0)
        const weekMin = thisWeek.reduce((n, c) => n + Number(c.minutes ?? 0), 0)
        // this week, Monday to Sunday, one stacked bar per day
        const KIND_ORDER = ['run', 'walk', 'cycle', 'swim', 'other']
        const today = localDate()
        const weeks: { num: string; kinds: Map<string, number>; total: number; now: boolean }[] = []
        for (let i = 0; i < 7; i++) {
          const d = new Date(thisMonday + 'T00:00:00')
          d.setDate(d.getDate() + i)
          const date = localDate(d)
          const kinds = new Map<string, number>()
          for (const c of cardio) {
            if (c.date !== date) continue
            const km = Number(c.distance_km ?? 0)
            if (!km) continue
            const kind = KIND_ORDER.includes(c.kind) ? c.kind : 'other'
            kinds.set(kind, (kinds.get(kind) ?? 0) + km)
          }
          const total = [...kinds.values()].reduce((a, b) => a + b, 0)
          weeks.push({
            num: d.toLocaleDateString(undefined, { weekday: 'short' }),
            kinds,
            total,
            now: date === today,
          })
        }
        const maxKm = Math.max(1, ...weeks.map((w) => w.total))
        const presentKinds = KIND_ORDER.filter((k) => weeks.some((w) => w.kinds.has(k)))
        const runs = cardio.filter((c) => Number(c.distance_km ?? 0) >= 1 && c.minutes)
        const longest = runs.length ? Math.max(...runs.map((c) => Number(c.distance_km))) : null
        const paces = runs.filter((c) => Number(c.distance_km) >= 2).map((c) => Number(c.minutes) / Number(c.distance_km))
        const bestPace = paces.length ? Math.min(...paces) : null
        const kindIcon = (k: string) => CARDIO_KINDS.find(([v]) => v === k)?.[1].split(' ')[0] ?? '🏃'
        const target = cardioTargetForWeek(cardioBase ?? DEFAULT_BASE_KM, week ?? 1)
        const pct = Math.min(100, Math.round((weekKm / target.km) * 100))
        return (
          <section className="gym-day cardio-card">
            <h2>
              Cardio
              <span className="routine-progress">
                {weekKm > 0 || weekMin > 0
                  ? ` this week: ${weekKm > 0 ? `${Math.round(weekKm * 10) / 10} km` : ''}${weekKm > 0 && weekMin > 0 ? ' · ' : ''}${weekMin > 0 ? `${Math.round(weekMin)} min` : ''}`
                  : ' nothing yet this week — that’s allowed'}
              </span>
            </h2>

            <div className="cardio-plan">
              <div className="cardio-plan-head">
                <span className="cardio-plan-phase">{target.phase} week</span>
                <span className="cardio-plan-target">
                  aim ~{target.km} km · {target.sessions} easy sessions
                </span>
              </div>
              <div className="cardio-plan-rail" aria-hidden="true">
                <div className="cardio-plan-fill" style={{ width: `${pct}%` }} />
              </div>
              <p className="gentle cardio-plan-note">
                {Math.round(weekKm * 10) / 10} / {target.km} km so far. {target.note}
              </p>
              <div className="cardio-plan-base">
                <span className="gentle-inline">Easy-week base</span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={baseDraft}
                  onChange={(e) => setBaseDraft(e.target.value)}
                  onBlur={saveCardioBase}
                  onKeyDown={(e) => e.key === 'Enter' && saveCardioBase()}
                />
                <span className="gentle-inline">km/week</span>
              </div>
            </div>

            <div className="run-log-row">
              <select value={run.kind} onChange={(e) => setRun({ ...run, kind: e.target.value })}>
                {CARDIO_KINDS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="decimal"
                placeholder="km"
                value={run.km}
                onChange={(e) => setRun({ ...run, km: e.target.value })}
              />
              <input
                type="number"
                inputMode="numeric"
                placeholder="min"
                value={run.min}
                onChange={(e) => setRun({ ...run, min: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && logRun()}
              />
              <button className="run-log-btn" onClick={logRun} disabled={loggingRun}>
                {loggingRun ? '…' : 'Log'}
              </button>
            </div>

            {weeks.some((w) => w.total > 0) && (
              <>
                <div className="run-weeks">
                  {weeks.map((w, i) => (
                    <div
                      key={i}
                      className="reflect-day"
                      title={`${w.num}: ${[...w.kinds.entries()].map(([k, v]) => `${k} ${Math.round(v * 10) / 10}km`).join(', ') || 'nothing'}`}
                    >
                      <div className="bar-wrap run-bar-wrap">
                        <div className={w.now ? 'run-stack now' : 'run-stack'}>
                          {KIND_ORDER.filter((k) => w.kinds.has(k)).map((k) => (
                            <div key={k} className={`run-seg ${k}`} style={{ height: `${(w.kinds.get(k)! / maxKm) * 100}%` }} />
                          ))}
                        </div>
                      </div>
                      <span className="bar-count">{w.total > 0 ? Math.round(w.total * 10) / 10 : ''}</span>
                      <span className={w.now ? 'bar-day now-label' : 'bar-day'}>{w.num}</span>
                    </div>
                  ))}
                </div>
                {presentKinds.length > 1 && (
                  <div className="run-legend">
                    {presentKinds.map((k) => (
                      <span key={k} className="run-legend-item">
                        <span className={`run-dot ${k}`} />
                        {k}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}

            {(longest || bestPace) && (
              <p className="gentle run-stats">
                {longest ? `Longest: ${longest} km` : ''}
                {longest && bestPace ? ' · ' : ''}
                {bestPace ? `Best pace: ${fmtPace(bestPace, 1)}` : ''}
              </p>
            )}

            {(() => {
              const recent = cardio.filter(
                (c) => Date.now() - new Date(c.date + 'T00:00:00').getTime() < 14 * 86400000,
              )
              const over = recent.filter((c) => c.amount === 'over_the_line').length
              const more = recent.filter((c) => c.amount === 'could_take_more').length
              if (over >= 2 && !localStorage.getItem('cardio-sugg-over')) {
                return (
                  <div className="notice vol-suggestion">
                    Cardio has said “over the line” a couple of times lately — an easier week is a fine plan.
                    <button
                      className="link"
                      onClick={() => {
                        localStorage.setItem('cardio-sugg-over', '1')
                        load()
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              }
              if (more >= 2 && over === 0 && !localStorage.getItem('cardio-sugg-more')) {
                return (
                  <div className="notice vol-suggestion">
                    Cardio keeps saying “could take more” — want to nudge the distance up a little?
                    <button
                      className="link"
                      onClick={() => {
                        localStorage.setItem('cardio-sugg-more', '1')
                        load()
                      }}
                    >
                      ✕
                    </button>
                  </div>
                )
              }
              return null
            })()}

            {cardio.slice(0, 12).map((c) => {
              const pace = fmtPace(Number(c.minutes), Number(c.distance_km))
              if (editCardio?.id === c.id) {
                return (
                  <div key={c.id} className="edit-task cardio-edit">
                    <div className="edit-task-row">
                      <select value={editCardio.kind} onChange={(e) => setEditCardio({ ...editCardio, kind: e.target.value })}>
                        {CARDIO_KINDS.map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        inputMode="decimal"
                        placeholder="km"
                        value={editCardio.km}
                        onChange={(e) => setEditCardio({ ...editCardio, km: e.target.value })}
                      />
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="min"
                        value={editCardio.min}
                        onChange={(e) => setEditCardio({ ...editCardio, min: e.target.value })}
                      />
                    </div>
                    <div className="edit-task-row">
                      <input
                        placeholder="notes"
                        value={editCardio.notes}
                        onChange={(e) => setEditCardio({ ...editCardio, notes: e.target.value })}
                      />
                    </div>
                    {CARDIO_QUESTIONS.map((q) => (
                      <div key={q.field} className="checkin-q">
                        <span className="energy-label">{q.label}</span>
                        <div className="checkin-pills">
                          {q.options.map(([value, label]) => (
                            <button
                              key={value}
                              className={c[q.field] === value ? 'energy-btn active' : 'energy-btn'}
                              onClick={() => setCardioFeel(c.id, q.field, value)}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <div className="edit-task-row">
                      <button className="save" onClick={saveCardio}>
                        Save
                      </button>
                      <button className="link" onClick={() => setEditCardio(null)}>
                        Close
                      </button>
                      <button className="danger" onClick={() => deleteCardio(c.id)}>
                        Delete
                      </button>
                    </div>
                  </div>
                )
              }
              return (
                <div key={c.id} className="gym-entry run-entry">
                  <span className="gym-exercise">
                    {kindIcon(c.kind)} {c.date}
                  </span>
                  <span className="gym-sets">
                    {c.distance_km ? `${c.distance_km} km` : ''}
                    {c.distance_km && c.minutes ? ' · ' : ''}
                    {c.minutes ? `${c.minutes} min` : ''}
                    {pace ? ` · ${pace}` : ''}
                  </span>
                  <button
                    className="link run-edit"
                    onClick={() =>
                      setEditCardio({
                        id: c.id,
                        kind: c.kind,
                        km: c.distance_km != null ? String(c.distance_km) : '',
                        min: c.minutes != null ? String(c.minutes) : '',
                        notes: c.notes ?? '',
                      })
                    }
                  >
                    edit
                  </button>
                  {c.notes && <span className="gym-notes">{c.notes}</span>}
                </div>
              )
            })}
            {cardio.length === 0 && (
              <p className="gentle">
                Log above, tell the composer <em>“ran 5k in 32 min”</em>, or finish a Pull session — they all land here.
              </p>
            )}
          </section>
        )
      })()}

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
            <input
              placeholder="3 x 10-12"
              value={scratch.scheme}
              onChange={(e) => setScratch({ ...scratch, scheme: e.target.value })}
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
          <div className="energy-row plan-row">
            <span className="energy-label">Session</span>
            {(split && !rotation.includes(split) ? [...rotation, split] : rotation).map((s) => (
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
                  value={newSession}
                  onChange={(e) => setNewSession(e.target.value)}
                  placeholder="New session name (e.g. Upper C)"
                />
                <button
                  onClick={() => {
                    const v = newSession.trim()
                    if (!v) return
                    setSplit(v)
                    setNewSession('')
                  }}
                >
                  Add session
                </button>
              </div>
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
