import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { phaseKey, recoveryAdjustments, setCount, startBlock } from '../lib/blocks'
import { seedWorkoutTemplate } from '../lib/workoutTemplate'
import { DEFAULT_BASE_KM } from '../lib/cardioPlan'
import { t } from '../i18n'
import Session from './Session'
import { usePresence } from '../lib/overlay'
import GymCardio from './GymCardio'
import PlanEditor, { MUSCLE_GROUPS, composeScheme } from './PlanEditor'
import type { BlockApplyDiff } from './PlanEditor'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import ExerciseAutocomplete from '../components/ExerciseAutocomplete'

const PHASES: { key: string; name: string; maxWeek: number }[] = [
  { key: '1-2', name: t.gym.phases['1-2'], maxWeek: 2 },
  { key: '3-4', name: t.gym.phases['3-4'], maxWeek: 4 },
  { key: '5-6', name: t.gym.phases['5-6'], maxWeek: 6 },
]

const muscleLabel = (m: string) => t.muscles[m] ?? m

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
  const [loggedSets, setLoggedSets] = useState<{ muscle_group: string | null; session_id: string; logged_reps: number | null; logged_at: string | null }[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  const [overLine, setOverLine] = useState<string[]>([]) // muscles flagged 2+ times recently
  const [review, setReview] = useState<{ advice: string; week_start: string } | null>(null) // weekly AI coach note
  const [nextTweaks, setNextTweaks] = useState<string | null>(null) // wrap-up preview
  const [active, setActive] = useState<PlannedSession | null>(null)
  // the session screen keeps rendering its last value while the exit plays
  const sessionOverlay = usePresence(active !== null)
  const lastActive = useRef(active)
  if (active) lastActive.current = active
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
    const [logsRes, plansRes, settingsRes, firstRes, blockRes, cardioAllRes, reviewRes] = await Promise.all([
      supabase.from('workout_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('workout_plans').select('*').order('sort_order'),
      supabase.from('user_settings').select('program_start, cardio_target_km').maybeSingle(),
      supabase.from('workout_logs').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('training_blocks').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('cardio_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      supabase.from('training_reviews').select('advice, week_start').order('week_start', { ascending: false }).limit(1).maybeSingle(),
    ])
    setReview((reviewRes.data as { advice: string; week_start: string } | null) ?? null)
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
          .select('muscle_group, session_id, logged_reps, logged_at')
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
   *  for each week's phase); removed exercises lose their unlogged sets. A
   *  brand-new split day gets sessions created for every week first - the
   *  grid draws its rows from week 1, so a partial set of weeks would hide
   *  it. Logged history is never touched and the week counter stays put. */
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
        let targets = sessions.filter((s) => !s.completed_at)
        // new split days with something loggable get their sessions now; a
        // rest-day split (no set counts) gets none - a session with zero
        // sets could never complete and would wedge the up-next pointer
        const newSplits = [...new Set(blockApply.added.map((a) => a.split_day))].filter(
          (sd) =>
            !sessions.some((s) => s.split_day === sd) &&
            blockApply.added.some((a) => a.split_day === sd && setCount(a.schemes?.['1-2']) > 0),
        )
        if (newSplits.length > 0) {
          const maxDay = Math.max(0, ...sessions.map((s) => s.day_number))
          const rows: Record<string, unknown>[] = []
          newSplits.forEach((sd, i) => {
            for (let w = 1; w <= block.total_weeks; w++) {
              rows.push({ block_id: block.id, week_number: w, day_number: maxDay + 1 + i, split_day: sd })
            }
          })
          const { data: created, error } = await supabase
            .from('planned_sessions')
            .insert(rows)
            .select('id, block_id, week_number, day_number, split_day, cardio, date, completed_at')
          if (error) throw error
          targets = [...targets, ...((created ?? []) as PlannedSession[])]
        }
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

  // volume picture: hard sets (reps actually logged) per muscle per week.
  // Sets count in the week they were ACTUALLY performed (like the weekly
  // coach's note), not the plan week their session belongs to - a catch-up
  // session shows up where the work really happened
  const volume = new Map<string, number[]>()
  if (block) {
    const blockWeekOf = (date: string) =>
      Math.floor(
        (new Date(date + 'T00:00:00').getTime() - new Date(block.start_date + 'T00:00:00').getTime()) /
          (7 * 86400000),
      ) + 1
    for (const s of loggedSets) {
      if (s.logged_reps == null || !s.muscle_group || !s.logged_at) continue
      const wk = blockWeekOf(s.logged_at.slice(0, 10))
      if (wk < 1 || wk > block.total_weeks) continue
      const arr = volume.get(s.muscle_group) ?? Array(block.total_weeks).fill(0)
      arr[wk - 1]++
      volume.set(s.muscle_group, arr)
    }
    // freeform lifts (composer) count too - interpret tags their
    // muscle group, and their date places them in a block week
    for (const log of logs) {
      if (!log.muscle_group || !log.sets?.length) continue
      const wk = blockWeekOf(log.date)
      if (wk < 1 || wk > block.total_weeks) continue
      const arr = volume.get(log.muscle_group) ?? Array(block.total_weeks).fill(0)
      arr[wk - 1] += log.sets.length
      volume.set(log.muscle_group, arr)
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
      setNextTweaks([...a.entries()].map(([m, d]) => t.gym.tweakSet(muscleLabel(m), d > 0)).join(' · ')),
    )
  }, [blockDone]) // eslint-disable-line react-hooks/exhaustive-deps

  const blockPlans = plans.filter((p) => p.block === planBlock)
  const availableBlocks = [...new Set(plans.map((p) => p.block))].sort()
  const rotation = [...new Set(blockPlans.map((p) => p.split_day))]
  const splitPlans = blockPlans.filter((p) => p.split_day === split)
  const splitCardio = splitPlans.find((p) => p.cardio)?.cardio

  return (
    <div className="gym">
      <h1>{t.gym.title}</h1>
      <div className="energy-row seg-row">
        <button
          className={view === 'strength' ? 'energy-btn active' : 'energy-btn'}
          aria-pressed={view === 'strength'}
          onClick={() => setView('strength')}
        >
          <Icon name="dumbbell" /> {t.gym.strength}
        </button>
        <button
          className={view === 'cardio' ? 'energy-btn active' : 'energy-btn'}
          aria-pressed={view === 'cardio'}
          onClick={() => setView('cardio')}
        >
          <Icon name="run" /> {t.gym.cardio}
        </button>
      </div>
      {view === 'strength' && (
        <p className="gentle">
          {t.gym.strengthHint}
          <em>{t.gym.strengthHintExample}</em>.
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
              <span className="routine-progress">{t.gym.weekOf(blockWeek, block.total_weeks)}</span>
            </h2>
            <div className="weeks-grid" role="grid" aria-label={t.gym.blockSessionsAria}>
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
                        title={t.gym.sessionCellTitle(s.split_day, w, !!s.completed_at)}
                        onClick={() => setActive(s)}
                      >
                        {s.completed_at ? <Icon name="check" /> : ''}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
            <p className="gentle">{t.gym.tapCellHint}</p>
            {upNext && !blockDone && (
              <button className="start-session" onClick={() => setActive(upNext)}>
                <Icon name="play" /> {upNext.date && !upNext.completed_at ? t.gym.continue : t.gym.start} {upNext.split_day}
                <span className="routine-progress">{t.gym.weekTag(upNext.week_number)}</span>
              </button>
            )}
          </section>
        )
      })()}

      {view === 'strength' && block && blockDone && (
        <section className="gym-day wrapup-card">
          <h2>
            {block.name}{t.gym.wrapped}
            <span className="routine-progress"> <Icon name="check" /></span>
          </h2>
          <p className="gentle">
            {t.gym.wrapSummary(doneSessionCount, sessions.length, loggedSets.filter((s) => s.logged_reps != null).length)}
            {doneSessionCount < sessions.length && t.gym.openSessionsStay}
          </p>
          <p className="gentle">
            {nextTweaks
              ? t.gym.tweaksFromCheckins(nextTweaks)
              : t.gym.checkinsAllRight}
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
                {starting ? t.gym.generating : t.gym.yesGenerate(nextBlockNumber)}
              </button>
              <button className="link" onClick={() => setConfirmBlock(null)}>
                {t.common.cancel}
              </button>
            </>
          ) : (
            <button className="start-session" onClick={() => setConfirmBlock(nextBlockNumber)} disabled={starting}>
              {starting
                ? t.gym.generating
                : t.gym.startBlockLong(nextBlockNumber, nextBlockNumber === 2, nextBlockNumber === (block.block ?? 1))}
            </button>
          )}
        </section>
      )}

      {view === 'strength' && loaded && blockPlans.length > 0 && (!block || block.block !== planBlock) && (
        confirmBlock === planBlock ? (
          <div className="start-block-confirm">
            {block && !sessions.every((s) => s.completed_at) && (
              <p className="gentle">
                {t.gym.currentBlockUnfinished(block.name)}
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
              {starting ? t.gym.generating : t.gym.yesGenerate(planBlock)}
            </button>
            <button className="link" onClick={() => setConfirmBlock(null)}>
              {t.common.cancel}
            </button>
          </div>
        ) : (
          <button className="start-session lone" onClick={() => setConfirmBlock(planBlock)} disabled={starting}>
            {starting ? t.gym.generating : t.gym.startBlockFromPlan(planBlock)}
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
          {t.gym.overLineNotice(muscleLabel(mg))}
          <button
            className="link"
            onClick={() => {
              localStorage.setItem(`vol-sugg-${mg}`, '1')
              setOverLine(overLine.filter((m) => m !== mg))
            }}
            aria-label={t.common.dismiss}
          >
            <Icon name="x" />
          </button>
        </div>
      ))}

      {view === 'strength' && review && (
        <section className="gym-day training-card">
          <h2>
            {t.gym.coachTitle}
            <span className="routine-progress">{t.gym.coachSub}</span>
          </h2>
          <p className="training-body">{review.advice}</p>
        </section>
      )}

      {view === 'strength' && block && volume.size > 0 && (
        <section className="gym-day volume-card">
          <h2>
            {t.gym.volumePicture}
            <span className="routine-progress">{t.gym.hardSetsPerWeek}</span>
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
                    <span className="volume-label">{muscleLabel(mg)}</span>
                    <span className="volume-avg">{t.gym.avg(avg)}</span>
                  </div>
                  <div className="volume-bars">
                    {weeks.map((n, i) => {
                      const state = i + 1 === currentWeek ? 'now' : i + 1 > currentWeek ? 'future' : ''
                      return (
                        <div key={i} className="volume-col" title={t.gym.volumeColTitle(i + 1, n)}>
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
          <h2>{t.gym.setupTitle}</h2>
          <p className="gentle">{t.gym.setupSubtitle}</p>
          <button className="start-session" onClick={useTemplate} disabled={settingUp}>
            {settingUp ? t.gym.settingUp : t.gym.useStarter}
          </button>
          <p className="gentle">
            {t.gym.starterDesc}
          </p>
          <p className="gentle setup-or">{t.gym.orBuildOwn}</p>
          <div className="add-task">
            <input
              placeholder={t.gym.firstSessionPh}
              value={scratch.session}
              onChange={(e) => setScratch({ ...scratch, session: e.target.value })}
            />
          </div>
          <div className="add-task">
            <ExerciseAutocomplete
              placeholder={t.gym.firstExercisePh}
              value={scratch.exercise}
              onChange={(exercise) => setScratch({ ...scratch, exercise })}
              onPick={(exercise, muscle) => setScratch({ ...scratch, exercise, muscle })}
            />
            <select value={scratch.muscle} onChange={(e) => setScratch({ ...scratch, muscle: e.target.value })}>
              {MUSCLE_GROUPS.map((m) => (
                <option key={m} value={m}>{muscleLabel(m)}</option>
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
            <span className="scheme-x">{t.gym.setsX}</span>
            <input
              placeholder={t.gym.repsPh}
              value={scratch.reps}
              onChange={(e) => setScratch({ ...scratch, reps: e.target.value })}
            />
          </div>
          <button
            className="start-session"
            onClick={createOwnPlan}
            disabled={settingUp || !scratch.session.trim() || !scratch.exercise.trim()}
          >
            {settingUp ? '…' : t.gym.createMyPlan}
          </button>
          <p className="gentle">{t.gym.addMoreAfter}</p>
        </section>
      )}

      {view === 'strength' && plans.length > 0 && (
        <section className="gym-day plan-card">
          <div className="routine-header">
            <h2>
              {t.gym.thePlan}
              <span className="routine-progress">{phase ? ` ${phase.name}` : week !== null && week > 6 ? t.gym.deloadSoon : ''}</span>
            </h2>
            {!editingPlan && (
              <button className="energy-btn" onClick={() => setEditingPlan(true)}>
                {t.common.Edit}
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
                  title={editingPlan ? t.gym.saveEditFirst : undefined}
                  onClick={() => {
                    setPlanBlock(b)
                    const firstSplit = plans.find((p) => p.block === b)?.split_day ?? null
                    setSplit(firstSplit)
                  }}
                >
                  {t.gym.blockBtn(b)}
                </button>
              ))}
            </div>
          )}
          {!block && (
            <div className="energy-row plan-row">
              <span className="energy-label">{t.gym.weekLabel}</span>
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
              <span className="energy-label">{t.gym.sessionLabel}</span>
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
                {p.safety_note && <span className="gym-notes"><Icon name="shield" /> {p.safety_note}</span>}
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
          {splitCardio && !editingPlan && <p className="gentle plan-cardio">{t.gym.planCardio(splitCardio)}</p>}
        </section>
      )}

      {view === 'strength' && blockApply && block && (() => {
        // new split days whose exercises carry no set counts (a rest day):
        // they get no sessions - say so instead of silently doing nothing
        const restSplits = [...new Set(blockApply.added.map((a) => a.split_day))].filter(
          (sd) =>
            !sessions.some((s) => s.split_day === sd) &&
            !blockApply.added.some((a) => a.split_day === sd && setCount(a.schemes?.['1-2']) > 0),
        )
        return (
          <div className="install-help-backdrop" onClick={() => !applying && setBlockApply(null)}>
            <div className="install-help" role="dialog" aria-label={t.gym.applyToBlock} onClick={(e) => e.stopPropagation()}>
              <p className="install-title">
                {[
                  blockApply.added.length > 0 ? t.gym.addedList(blockApply.added.map((a) => a.exercise).join(', ')) : null,
                  blockApply.removed.length > 0 ? t.gym.removedList(blockApply.removed.map((r) => r.exercise).join(', ')) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                {t.gym.applyPrompt(block.name)}
              </p>
              <p className="install-body">{t.gym.applyKeepLogs}</p>
              {restSplits.length > 0 && <p className="install-body">{t.gym.noLoggableNote(restSplits.join(', '))}</p>}
              <div className="install-actions">
                <button className="start-session" onClick={applyToRunningBlock} disabled={applying}>
                  {applying ? t.gym.applying : t.gym.applyToBlock}
                </button>
                <button className="link" onClick={() => setBlockApply(null)} disabled={applying}>
                  {t.gym.nextBlockOnly}
                </button>
              </div>
            </div>
          </div>
        )
      })()}

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
      {view === 'strength' && loaded && logs.length === 0 && <p className="gentle">{t.gym.noFreeform}</p>}

      {sessionOverlay.mounted && (active ?? lastActive.current) && (
        <Session
          session={(active ?? lastActive.current)!}
          plans={plans}
          closing={sessionOverlay.closing}
          onExit={() => {
            setActive(null)
            load()
          }}
        />
      )}
    </div>
  )
}
