import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from '../lib/types'
import { phaseKey, recoveryAdjustments, setCount, startBlock } from '../lib/blocks'
import { composeFlexSession, composeFlexWeek, createFlexSession, createFlexWeek, isFlex } from '../lib/flexSession'
import type { FlexComposition, FlexFocus, FlexLength, FlexWeekPlan, MuscleNeed } from '../lib/flexSession'
import { seedWorkoutTemplate } from '../lib/workoutTemplate'
import { DEFAULT_BASE_KM } from '../lib/cardioPlan'
import { t, locale } from '../i18n'
import Session from './Session'
import { usePresence } from '../lib/overlay'
import { useCardioTracking } from '../lib/cardioTracking'
import GymCardio from './GymCardio'
import PlanEditor, { MUSCLE_GROUPS, composeScheme } from './PlanEditor'
import type { BlockApplyDiff } from './PlanEditor'
import Skeleton from '../components/Skeleton'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import { Button, Card, Chips, Dialog, Disclosure, EmptyState, ErrorState, Notice, ProgressBar, ScreenHeader, Segmented, cx } from '../components/ui'
import type { ChoiceOption } from '../components/ui'
import ExerciseAutocomplete from '../components/ExerciseAutocomplete'
import { MAX_LEN } from '../lib/limits'
import InjuryCard from './InjuryCard'
import { reconcileInjuries } from '../lib/injuries'
import { suggestTunings } from '../lib/volumeTuning'
import type { Tuning, TuningCheckin } from '../lib/volumeTuning'
import type { Injury } from '../lib/injuries'

const PHASES: { key: string; name: string; maxWeek: number }[] = [
  { key: '1-2', name: t.gym.phases['1-2'], maxWeek: 2 },
  { key: '3-4', name: t.gym.phases['3-4'], maxWeek: 4 },
  { key: '5-6', name: t.gym.phases['5-6'], maxWeek: 6 },
]

const muscleLabel = (m: string) => t.muscles[m] ?? m

/** The Workout screen's four views: do, plan, look back, cardio. */
type GymView = 'train' | 'plan' | 'progress' | 'cardio'

/** The volume picture's "last month" window: four whole weeks. */
const MONTH_DAYS = 28

/** "Knee (moderate), Shoulder (mild)" for the injury lines on this tab. */
const injuryList = (injuries: Injury[]) =>
  injuries.map((i) => `${t.injuries.parts[i.body_part]} (${t.injuries.severities[i.severity].toLowerCase()})`).join(', ')

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

export default function Gym({ visible, onOpenSettings }: { visible: boolean; onOpenSettings: () => void }) {
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [plans, setPlans] = useState<WorkoutPlan[]>([])
  const [block, setBlock] = useState<TrainingBlock | null>(null)
  const [sessions, setSessions] = useState<PlannedSession[]>([])
  const [loggedSets, setLoggedSets] = useState<{ muscle_group: string | null; session_id: string; logged_reps: number | null; logged_at: string | null }[]>([])
  // hard sets of the trailing 4 weeks, across blocks - the monthly ranking
  const [monthSets, setMonthSets] = useState<{ muscle_group: string | null; logged_at: string }[]>([])
  const [cardio, setCardio] = useState<CardioLog[]>([])
  // plan tuning inputs: check-ins of the last 60 days, and when each muscle
  // was last tuned (applied or dismissed) - see lib/volumeTuning.ts
  const [tuneCheckins, setTuneCheckins] = useState<TuningCheckin[]>([])
  const [lastTuned, setLastTuned] = useState<Map<string, string>>(new Map())
  const [tuningBusy, setTuningBusy] = useState(false)
  const [review, setReview] = useState<{ advice: string; week_start: string } | null>(null) // weekly AI coach note
  const [injuries, setInjuries] = useState<Injury[]>([]) // active (not healed) injury reports
  const [nextTweaks, setNextTweaks] = useState<string | null>(null) // wrap-up preview
  const [active, setActive] = useState<PlannedSession | null>(null)
  // the session screen keeps rendering its last value while the exit plays
  const sessionOverlay = usePresence(active !== null)
  const lastActive = useRef(active)
  if (active) lastActive.current = active
  const [planBlock, setPlanBlock] = useState(1) // which block the plan card shows
  const [editingPlan, setEditingPlan] = useState(false)
  const [cardioBase, setCardioBase] = useState<number | null>(null) // null=loading
  // always opens on Train - the view you came to do something in - rather
  // than remembering whichever was open last
  const [pickedView, setView] = useState<GymView>('train')
  // cardio logging switched off in Settings (a watch tracks it): no Cardio view
  const cardioOn = useCardioTracking()
  const view: GymView = !cardioOn && pickedView === 'cardio' ? 'train' : pickedView
  const [loadError, setLoadError] = useState(false)
  const loadedRef = useRef(false)

  const [scratch, setScratch] = useState({ session: '', exercise: '', muscle: 'Other', sets: '3', reps: '10-12' })
  const [settingUp, setSettingUp] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirmBlock, setConfirmBlock] = useState<number | null>(null) // which block's start is awaiting a yes
  const [blockApply, setBlockApply] = useState<BlockApplyDiff | null>(null) // saved plan changes awaiting "this block too?"
  // flexible session composer (life cut the week short)
  const [flexFocus, setFlexFocus] = useState<FlexFocus>('upper')
  const [flexLength, setFlexLength] = useState<FlexLength>('full')
  const [flexPreview, setFlexPreview] = useState<FlexComposition | null>(null)
  const [flexVariant, setFlexVariant] = useState(0)
  const [flexBusy, setFlexBusy] = useState(false)
  // the week layer: "I have N gym days this week" -> a laid-out reduced week
  const [flexWeekDays, setFlexWeekDays] = useState<number | null>(null)
  const [flexWeekPreview, setFlexWeekPreview] = useState<FlexWeekPlan | null>(null)
  const [showPastFlex, setShowPastFlex] = useState(false)
  const [showTune, setShowTune] = useState(false) // suggested plan changes, folded like past flex sessions
  // the composer is a secondary tool: it stays folded so the card reads as
  // one line until the day actually calls for it
  const [flexOpen, setFlexOpen] = useState(false)
  const [applyResult, setApplyResult] = useState<string | null>(null) // what the last apply actually did
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
    const tuneSince = new Date(Date.now() - 60 * 86400000).toISOString()
    const [logsRes, plansRes, settingsRes, firstRes, blockRes, cardioAllRes, reviewRes, injuriesRes, monthRes, checkinRes, tunedRes] = await Promise.all([
      supabase.from('workout_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      supabase.from('workout_plans').select('*').order('sort_order'),
      supabase.from('user_settings').select('program_start, cardio_target_km').maybeSingle(),
      supabase.from('workout_logs').select('date').order('date', { ascending: true }).limit(1).maybeSingle(),
      supabase.from('training_blocks').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('cardio_logs').select('*').order('date', { ascending: false }).order('created_at', { ascending: false }).limit(100),
      supabase.from('training_reviews').select('advice, week_start').order('week_start', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('injuries').select('*').is('healed_on', null).order('created_at'),
      supabase
        .from('planned_sets')
        .select('muscle_group, logged_at')
        .not('logged_reps', 'is', null)
        .gte('logged_at', new Date(Date.now() - MONTH_DAYS * 86400000).toISOString()),
      supabase
        .from('recovery_checkins')
        .select('muscle_group, amount, created_at')
        .not('amount', 'is', null)
        .gte('created_at', tuneSince),
      supabase.from('plan_tunings').select('muscle_group, created_at').gte('created_at', tuneSince),
    ])
    // a failed first load must not pass for "no plan yet"; a failed refresh
    // keeps what is already on screen
    if (plansRes.error) {
      if (!loadedRef.current) setLoadError(true)
      return
    }
    setLoadError(false)
    loadedRef.current = true
    setMonthSets(monthRes.data ?? [])
    setTuneCheckins((checkinRes.data as TuningCheckin[]) ?? [])
    const tuned = new Map<string, string>()
    for (const r of (tunedRes.data ?? []) as { muscle_group: string; created_at: string }[]) {
      if (r.created_at > (tuned.get(r.muscle_group) ?? '')) tuned.set(r.muscle_group, r.created_at)
    }
    setLastTuned(tuned)
    const injuryRows = (injuriesRes.data as Injury[]) ?? []
    setInjuries(injuryRows)
    setReview((reviewRes.data as { advice: string; week_start: string } | null) ?? null)
    setCardio((cardioAllRes.data as CardioLog[]) ?? [])
    const logRows = (logsRes.data as WorkoutLog[]) ?? []
    const planRows = (plansRes.data as WorkoutPlan[]) ?? []
    setLogs(logRows)
    setPlans(planRows)
    const blockRow = blockRes.data as TrainingBlock | null
    setBlock(blockRow)
    // sessions created since an injury was reported (new block, flex day,
    // plan edits) get the treatment the user already approved for it
    if (injuryRows.length > 0) await reconcileInjuries(blockRow, planRows)
    if (blockRow) {
      const { data: sess } = await supabase
        .from('planned_sessions')
        .select('*')
        .eq('block_id', blockRow.id)
        .order('week_number')
        .order('day_number')
      const sessRows = (sess as PlannedSession[]) ?? []
      setSessions(sessRows)
      const { data: setsData } = await supabase
        .from('planned_sets')
        .select('muscle_group, session_id, logged_reps, logged_at')
        .in('session_id', sessRows.map((s) => s.id))
        .not('logged_at', 'is', null)
      setLoggedSets(setsData ?? [])
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

  // the apply-result notice clears itself; tapping it dismisses it earlier
  useEffect(() => {
    if (!applyResult) return
    const id = setTimeout(() => setApplyResult(null), 8000)
    return () => clearTimeout(id)
  }, [applyResult])

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

  /** A volume-picture suggestion, applied: the plan row gets its new set
   *  count (this phase on), the tuning is recorded - that starts the
   *  muscle's cooldown and tells the weekly coach - and, when the row belongs
   *  to the running block, the usual "apply to this block too?" question
   *  follows, so remaining sessions can pick the change up. */
  async function applyTuning(c: Tuning) {
    if (tuningBusy) return
    setTuningBusy(true)
    try {
      const { error } = await supabase.from('workout_plans').update({ schemes: c.schemes }).eq('id', c.plan.id)
      if (error) {
        setApplyResult(t.gym.tune.failed)
        return
      }
      await recordTuning(c, 'applied')
      if (block && block.block === c.plan.block) {
        setBlockApply({
          added: [],
          removed: [],
          changed: [{ exercise: c.plan.exercise, prevExercise: c.plan.exercise, split_day: c.plan.split_day, schemes: c.schemes }],
          removedSplits: [],
          cardio: {},
        })
      } else {
        setApplyResult(t.gym.tune.applied(c.plan.exercise, c.toSets))
      }
      await load()
    } finally {
      setTuningBusy(false)
    }
  }

  /** "Not now": nothing changes, but the muscle's check-ins start over, so
   *  the same answers never bring the same suggestion back. */
  async function dismissTuning(c: Tuning) {
    if (tuningBusy) return
    setTuningBusy(true)
    try {
      await recordTuning(c, 'dismissed')
      await load()
    } finally {
      setTuningBusy(false)
    }
  }

  async function recordTuning(c: Tuning, action: 'applied' | 'dismissed') {
    const row = {
      muscle_group: c.muscle,
      exercise: c.plan.exercise,
      split_day: c.plan.split_day,
      block: c.plan.block,
      delta: c.delta,
      from_sets: c.fromSets,
      to_sets: c.toSets,
      action,
    }
    await supabase.from('plan_tunings').insert(row)
    // the suggestion leaves the screen now, not when the reload lands
    setLastTuned((prev) => new Map(prev).set(c.muscle, new Date().toISOString()))
  }

  /** The "apply to this block too?" yes-branch: added exercises get sets
   *  appended to every not-yet-completed session of their split (right count
   *  for each week's phase); removed exercises lose their unlogged sets; a
   *  fully removed split loses its untouched shell sessions; sets x reps
   *  edits retarget unlogged sets and grow/shrink their count; cardio notes
   *  reach the remaining sessions. A brand-new split day gets sessions
   *  created for every week first - the grid draws its rows from week 1, so
   *  a partial set of weeks would hide it. Logged history is never touched
   *  and the week counter stays put. Everything is counted for the result
   *  notice, so applying is never silent again. */
  async function applyToRunningBlock() {
    if (!blockApply || !block || applying) return
    setApplying(true)
    try {
      let setsAdded = 0
      let setsRemoved = 0
      let setsUpdated = 0
      for (const r of blockApply.removed) {
        const ids = sessions.filter((s) => s.split_day === r.split_day).map((s) => s.id)
        if (ids.length > 0) {
          // fetch-then-delete so the count is known on every backend
          const { data: doomed } = await supabase
            .from('planned_sets').select('id').eq('exercise', r.exercise).is('logged_at', null).in('session_id', ids)
          if (doomed?.length) {
            await supabase.from('planned_sets').delete().in('id', doomed.map((d: { id: string }) => d.id))
            setsRemoved += doomed.length
          }
        }
      }
      // a split removed from the plan entirely: its untouched shell sessions
      // go too, so the grid row disappears - completed sessions and sessions
      // holding logged sets stay (they are history)
      if (blockApply.removedSplits.length > 0) {
        const withLogs = new Set(loggedSets.map((s) => s.session_id))
        const shells = sessions
          .filter((s) => blockApply.removedSplits.includes(s.split_day) && !s.completed_at && !withLogs.has(s.id))
          .map((s) => s.id)
        if (shells.length > 0) await supabase.from('planned_sessions').delete().in('id', shells)
      }
      let targets = sessions.filter((s) => !s.completed_at)
      if (blockApply.added.length > 0) {
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
              rows.push({
                block_id: block.id,
                week_number: w,
                day_number: maxDay + 1 + i,
                split_day: sd,
                cardio: blockApply.cardio[sd] ?? null,
              })
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
        setsAdded += sets.length
      }

      // sets x reps edits on kept exercises: unlogged sets of remaining
      // sessions get the new target, and their count grows or shrinks to
      // match - logged sets are out of reach by construction
      if (blockApply.changed.length > 0) {
        const changedSplits = new Set(blockApply.changed.map((c) => c.split_day))
        const sessIds = targets.filter((s) => changedSplits.has(s.split_day)).map((s) => s.id)
        const { data: allSets } = sessIds.length
          ? await supabase
              .from('planned_sets')
              .select('id, session_id, exercise, muscle_group, set_number, sort_order, logged_at, target_scheme')
              .in('session_id', sessIds)
          : { data: [] }
        const maxOrder = new Map<string, number>()
        for (const row of allSets ?? []) maxOrder.set(row.session_id, Math.max(maxOrder.get(row.session_id) ?? 0, row.sort_order))
        for (const c of blockApply.changed) {
          for (const s of targets.filter((x) => x.split_day === c.split_day)) {
            const scheme = c.schemes?.[phaseKey(s.week_number)] ?? null
            const want = setCount(scheme)
            const rows = (allSets ?? []).filter(
              (ps) => ps.session_id === s.id && (ps.exercise === c.exercise || ps.exercise === c.prevExercise),
            )
            if (rows.length === 0) continue
            const unlogged = rows.filter((r) => !r.logged_at).sort((a, b) => b.set_number - a.set_number)
            // shrink first (top set numbers, unlogged only), then retarget
            // the survivors - no point retargeting a set about to go
            const doomed = rows.length > want ? unlogged.slice(0, rows.length - want) : []
            if (doomed.length > 0) {
              await supabase.from('planned_sets').delete().in('id', doomed.map((r) => r.id))
              setsRemoved += doomed.length
            }
            const retarget = unlogged.filter((r) => !doomed.includes(r) && r.target_scheme !== scheme)
            if (retarget.length > 0) {
              await supabase.from('planned_sets').update({ target_scheme: scheme }).in('id', retarget.map((r) => r.id))
              setsUpdated += retarget.length
            }
            if (rows.length < want) {
              let order = maxOrder.get(s.id) ?? 0
              let num = Math.max(...rows.map((r) => r.set_number))
              const extra = []
              for (let i = rows.length; i < want; i++) {
                extra.push({
                  session_id: s.id,
                  sort_order: ++order,
                  exercise: c.exercise,
                  muscle_group: rows[0].muscle_group,
                  set_number: ++num,
                  target_scheme: scheme,
                })
              }
              maxOrder.set(s.id, order)
              const { error } = await supabase.from('planned_sets').insert(extra)
              if (!error) setsAdded += extra.length
            }
          }
        }
      }

      // cardio notes follow the remaining sessions of their split
      for (const [sd, c] of Object.entries(blockApply.cardio)) {
        const ids = sessions.filter((s) => !s.completed_at && s.split_day === sd).map((s) => s.id)
        if (ids.length > 0) await supabase.from('planned_sessions').update({ cardio: c }).in('id', ids)
      }

      setApplyResult(t.gym.applyResult(setsAdded, setsRemoved, setsUpdated))
      setBlockApply(null)
      load()
    } finally {
      setApplying(false)
    }
  }

  /** Per-muscle weekly picture for the flex composer: what the active block's
   *  plan intends per week at the current phase, vs. hard sets actually logged
   *  in the trailing 7 days (planned sessions and freeform lifts both count). */
  function muscleNeeds(activePlans: WorkoutPlan[], phase: string): MuscleNeed[] {
    const target = new Map<string, number>()
    for (const p of activePlans) {
      if (!p.muscle_group || p.muscle_group === 'Other') continue
      target.set(p.muscle_group, (target.get(p.muscle_group) ?? 0) + setCount(p.schemes?.[phase]))
    }
    const since = Date.now() - 7 * 86400000
    const done = new Map<string, number>()
    for (const s of loggedSets) {
      if (s.logged_reps == null || !s.muscle_group || !s.logged_at) continue
      if (new Date(s.logged_at).getTime() < since) continue
      done.set(s.muscle_group, (done.get(s.muscle_group) ?? 0) + 1)
    }
    for (const log of logs) {
      if (!log.muscle_group || !log.sets?.length) continue
      if (new Date(log.date + 'T12:00:00').getTime() < since) continue
      done.set(log.muscle_group, (done.get(log.muscle_group) ?? 0) + log.sets.length)
    }
    return [...target.entries()].map(([muscle, weeklyTarget]) => ({ muscle, weeklyTarget, done: done.get(muscle) ?? 0 }))
  }

  const focusLabel = (f: FlexFocus) => (f === 'full' ? t.gym.flex.fullBody : t.gym.flex[f])

  async function generateFlex(variant = 0) {
    if (!block || flexBusy) return
    setFlexBusy(true)
    try {
      const adjustments = await recoveryAdjustments()
      const activePlans = plans.filter((p) => p.block === block.block)
      const phase = phaseKey(Math.min(weekFromStart(block.start_date), block.total_weeks))
      setFlexVariant(variant)
      setFlexWeekPreview(null)
      setFlexWeekDays(null)
      setFlexPreview(
        composeFlexSession({
          plans: activePlans,
          phase,
          needs: muscleNeeds(activePlans, phase),
          adjustments,
          focus: flexFocus,
          length: flexLength,
          variant,
          injuries,
        }),
      )
    } finally {
      setFlexBusy(false)
    }
  }

  async function startFlex() {
    if (!block || !flexPreview || flexPreview.picks.length === 0 || flexBusy) return
    setFlexBusy(true)
    try {
      const wk = Math.min(weekFromStart(block.start_date), block.total_weeks)
      const created = await createFlexSession(block, wk, sessions, flexPreview.picks, t.gym.flex.sessionName(focusLabel(flexFocus)))
      // injury cues and lighter sets land before the session opens
      if (injuries.length > 0) await reconcileInjuries(block, plans)
      setFlexPreview(null)
      setActive(created)
      load()
    } finally {
      setFlexBusy(false)
    }
  }

  async function generateFlexWeek(days: number) {
    if (!block || flexBusy) return
    setFlexWeekDays(days)
    setFlexPreview(null)
    if (days === 0 || days >= 6) {
      setFlexWeekPreview(null)
      return
    }
    setFlexBusy(true)
    try {
      const adjustments = await recoveryAdjustments()
      const activePlans = plans.filter((p) => p.block === block.block)
      const phase = phaseKey(Math.min(weekFromStart(block.start_date), block.total_weeks))
      setFlexWeekPreview(
        composeFlexWeek({
          plans: activePlans,
          phase,
          needs: muscleNeeds(activePlans, phase),
          adjustments,
          days,
          length: flexLength,
          injuries,
        }),
      )
    } finally {
      setFlexBusy(false)
    }
  }

  async function deleteFlexSession(s: PlannedSession) {
    // children first: the DB cascades anyway, but the demo's fake client
    // has no cascades - explicit deletes keep both worlds clean
    await supabase.from('planned_sets').delete().eq('session_id', s.id)
    await supabase.from('recovery_checkins').delete().eq('session_id', s.id)
    await supabase.from('planned_sessions').delete().eq('id', s.id)
    if (active?.id === s.id) setActive(null)
    load()
  }

  async function startFlexWeek() {
    if (!block || !flexWeekPreview || flexWeekPreview.sessions.length === 0 || flexBusy) return
    setFlexBusy(true)
    try {
      const wk = Math.min(weekFromStart(block.start_date), block.total_weeks)
      const n = flexWeekPreview.sessions.length
      const names = flexWeekPreview.sessions.map((s, i) => t.gym.flex.weekSessionName(focusLabel(s.focus), i + 1, n))
      await createFlexWeek(block, wk, sessions, flexWeekPreview, names)
      if (injuries.length > 0) await reconcileInjuries(block, plans)
      setFlexWeekPreview(null)
      setFlexWeekDays(null)
      load()
    } finally {
      setFlexBusy(false)
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
      setView('plan')
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

  // the month at a glance: hard sets per muscle over the trailing four weeks,
  // most-trained first. Muscles the plan trains (the active block's, else the
  // one on screen) start at 0, so one that got nothing still shows up - as
  // the least trained, where it belongs
  const monthCounts = new Map<string, number>()
  const rankBlock = block?.block ?? planBlock
  for (const p of plans) {
    if (p.block === rankBlock && p.muscle_group && p.muscle_group !== 'Other') monthCounts.set(p.muscle_group, 0)
  }
  for (const s of monthSets) {
    if (s.muscle_group) monthCounts.set(s.muscle_group, (monthCounts.get(s.muscle_group) ?? 0) + 1)
  }
  const monthFrom = localDate(new Date(Date.now() - MONTH_DAYS * 86400000))
  for (const log of logs) {
    if (!log.muscle_group || !log.sets?.length || log.date < monthFrom) continue
    monthCounts.set(log.muscle_group, (monthCounts.get(log.muscle_group) ?? 0) + log.sets.length)
  }
  const monthVolume = [...monthCounts.entries()].sort((a, b) => b[1] - a[1])
  const monthMax = monthVolume[0]?.[1] ?? 0
  const monthMin = monthVolume[monthVolume.length - 1]?.[1] ?? 0
  // nothing logged all month: a list of zeros ranks nothing
  const showMonth = monthMax > 0

  // what the month + check-ins suggest for the plan: ±1 set, applied by tap.
  // A block younger than four weeks is judged on its own weeks only - the
  // previous block's sets would make its plan look over-delivered
  const tuneFrom = block && block.start_date > monthFrom ? block.start_date : monthFrom
  const tuneLogged = new Map<string, number>()
  for (const s of monthSets) {
    if (s.muscle_group && localDate(new Date(s.logged_at)) >= tuneFrom) tuneLogged.set(s.muscle_group, (tuneLogged.get(s.muscle_group) ?? 0) + 1)
  }
  for (const log of logs) {
    if (!log.muscle_group || !log.sets?.length || log.date < tuneFrom) continue
    tuneLogged.set(log.muscle_group, (tuneLogged.get(log.muscle_group) ?? 0) + log.sets.length)
  }
  const tuning = suggestTunings({
    plans: plans.filter((p) => p.block === rankBlock),
    phase: block ? phaseKey(Math.min(weekFromStart(block.start_date), block.total_weeks)) : '1-2',
    loggedSets: tuneLogged,
    weeks: (new Date(localDate() + 'T00:00:00').getTime() - new Date(tuneFrom + 'T00:00:00').getTime()) / (7 * 86400000),
    checkins: tuneCheckins,
    lastTuned,
    injuries,
  })
  // "behind plan" only means something against a running block; and when
  // every muscle is behind, the story is fewer sessions overall - one line
  const behind = block ? tuning.behind : []
  const allBehind = behind.length > 1 && behind.length === tuning.planned


  const byDate = new Map<string, WorkoutLog[]>()
  for (const log of logs) {
    const list = byDate.get(log.date) ?? []
    list.push(log)
    byDate.set(log.date, list)
  }

  // flex sessions ride along in the block (their sets count everywhere) but
  // stay out of the weekly grid and the wrapped/up-next math
  const gridSessions = sessions.filter((s) => !isFlex(s))
  const pendingFlex = sessions.filter((s) => isFlex(s) && !s.completed_at)
  // finished flex sessions have no grid cell, so this list is their only way
  // back in - reopening lands on the finish screen, where sets stay editable.
  // Only the five most recent are kept on screen, folded behind a toggle.
  const doneFlex = sessions
    .filter((s) => isFlex(s) && s.completed_at)
    .sort((a, b) => b.week_number - a.week_number || b.day_number - a.day_number)
    .slice(0, 5)

  // the block is "wrapped" when every session is handled or its weeks have run out
  const doneSessionCount = gridSessions.filter((s) => s.completed_at).length
  const blockDone =
    !!block &&
    gridSessions.length > 0 &&
    (doneSessionCount === gridSessions.length || weekFromStart(block.start_date) > block.total_weeks)
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

  const blockWeek = block ? Math.min(weekFromStart(block.start_date), block.total_weeks) : 1
  const upNext = gridSessions.find((s) => !s.completed_at)
  const fmtDay = (iso: string) =>
    new Date(iso + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })

  const viewOptions: ChoiceOption<GymView>[] = [
    { value: 'train', label: t.gym.tabTrain },
    { value: 'plan', label: t.gym.tabPlan },
    { value: 'progress', label: t.gym.tabProgress },
    ...(cardioOn ? [{ value: 'cardio' as const, label: t.gym.cardio }] : []),
  ]

  /** One row that opens a flex session, with its two-tap delete. */
  const flexRow = (s: PlannedSession, done: boolean) => (
    <div key={s.id} className="field-row field-row--tight">
      <Button className="grow gym__session-btn" icon={done ? 'check' : 'play'} onClick={() => setActive(s)}>
        {done ? '' : `${s.date ? t.gym.continue : t.gym.start} `}
        {s.split_day}
        <span className="meta">{t.gym.weekTag(s.week_number)}</span>
      </Button>
      <ConfirmButton
        iconOnly
        label={<Icon name="x" />}
        confirmLabel={t.gym.flex.deleteConfirm}
        title={t.gym.flex.deleteTitle(s.split_day)}
        onConfirm={() => deleteFlexSession(s)}
      />
    </div>
  )

  /** A composed session's exercises, as a quiet list. */
  const pickRows = (picks: { exercise: string; target_scheme: string | null; muscle_group: string }[]) => (
    <div className="rows">
      {picks.map((p, i) => (
        <div key={i} className="row gym__entry">
          <span className="row__main">
            <strong>{p.exercise}</strong> <span className="mono">{p.target_scheme}</span>
          </span>
          <span className="badge">{muscleLabel(p.muscle_group)}</span>
        </div>
      ))}
    </div>
  )

  const injuryNote = injuries.length > 0 && (
    <p className="hint">
      <Icon name="shield" /> {t.injuries.flexAround(injuryList(injuries))}
    </p>
  )

  /** "Start Block N", asked twice: generating six weeks of sessions is not a stray tap. */
  const startBlockControl = (blockNumber: number, label: string) =>
    confirmBlock === blockNumber ? (
      <div className="stack">
        {block && !gridSessions.every((s) => s.completed_at) && <p className="hint">{t.gym.currentBlockUnfinished(block.name)}</p>}
        <div className="actions">
          <Button
            variant="primary"
            busy={starting}
            onClick={() => {
              setConfirmBlock(null)
              beginBlock(blockNumber)
            }}
          >
            {starting ? t.gym.generating : t.gym.yesGenerate(blockNumber)}
          </Button>
          <Button variant="ghost" onClick={() => setConfirmBlock(null)}>
            {t.common.cancel}
          </Button>
        </div>
      </div>
    ) : (
      <Button block busy={starting} onClick={() => setConfirmBlock(blockNumber)}>
        {starting ? t.gym.generating : label}
      </Button>
    )

  const setupCard = (
    <Card title={t.gym.setupTitle}>
      <p className="hint">{t.gym.setupSubtitle}</p>
      <Button variant="primary" block busy={settingUp} onClick={useTemplate}>
        {settingUp ? t.gym.settingUp : t.gym.useStarter}
      </Button>
      <p className="hint">{t.gym.starterDesc}</p>
      <p className="hint gym__or">{t.gym.orBuildOwn}</p>
      <input
        placeholder={t.gym.firstSessionPh}
        aria-label={t.gym.firstSessionPh}
        value={scratch.session}
        maxLength={MAX_LEN.name}
        onChange={(e) => setScratch({ ...scratch, session: e.target.value })}
      />
      <div className="field-row">
        <ExerciseAutocomplete
          placeholder={t.gym.firstExercisePh}
          value={scratch.exercise}
          onChange={(exercise) => setScratch({ ...scratch, exercise })}
          onPick={(exercise, muscle) => setScratch({ ...scratch, exercise, muscle })}
        />
        <select value={scratch.muscle} aria-label={t.gym.firstExercisePh} onChange={(e) => setScratch({ ...scratch, muscle: e.target.value })}>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m} value={m}>
              {muscleLabel(m)}
            </option>
          ))}
        </select>
      </div>
      <div className="field-row field-row--tight">
        <input
          className="input--num"
          type="number"
          inputMode="numeric"
          min={1}
          max={10}
          aria-label={t.gym.setsX}
          value={scratch.sets}
          onChange={(e) => setScratch({ ...scratch, sets: e.target.value })}
        />
        <span className="hint">{t.gym.setsX}</span>
        <input
          className="grow"
          placeholder={t.gym.repsPh}
          aria-label={t.gym.repsPh}
          value={scratch.reps}
          maxLength={MAX_LEN.reps}
          onChange={(e) => setScratch({ ...scratch, reps: e.target.value })}
        />
      </div>
      <Button block busy={settingUp} onClick={createOwnPlan} disabled={!scratch.session.trim() || !scratch.exercise.trim()}>
        {t.gym.createMyPlan}
      </Button>
      <p className="hint">{t.gym.addMoreAfter}</p>
    </Card>
  )

  const flexToolsOpen = flexOpen || !!flexPreview || !!flexWeekPreview

  return (
    <div className="screen gym">
      <ScreenHeader title={t.gym.title} onOpenSettings={onOpenSettings} />
      <Segmented options={viewOptions} value={view} onChange={setView} label={t.gym.title} />

      {loadError && !loaded && <ErrorState onRetry={load} />}
      {!loaded && !loadError && <Skeleton cards={2} />}

      {applyResult && (
        <Notice tone="good" onDismiss={() => setApplyResult(null)}>
          {applyResult}
        </Notice>
      )}

      {view === 'train' && loaded && (
        <>
          {plans.length === 0 && setupCard}

          {block && upNext && !blockDone && (
            <Card tone="feature" className="upnext">
              <p className="eyebrow upnext__label">
                {t.now.upNext} ·{t.gym.weekTag(upNext.week_number)}
              </p>
              <p className="upnext__task">{upNext.split_day}</p>
              <Button variant="primary" block icon="play" onClick={() => setActive(upNext)}>
                {upNext.date && !upNext.completed_at ? t.gym.continue : t.gym.start} {upNext.split_day}
              </Button>
            </Card>
          )}

          {block && blockDone && (
            <Card
              tone="good"
              title={
                <>
                  {block.name}
                  {t.gym.wrapped} <Icon name="check" />
                </>
              }
            >
              <p className="hint">
                {t.gym.wrapSummary(doneSessionCount, gridSessions.length, loggedSets.filter((s) => s.logged_reps != null).length)}
                {doneSessionCount < gridSessions.length && t.gym.openSessionsStay}
              </p>
              <p className="hint">{nextTweaks ? t.gym.tweaksFromCheckins(nextTweaks) : t.gym.checkinsAllRight}</p>
              {confirmBlock === nextBlockNumber ? (
                <div className="actions">
                  <Button
                    variant="primary"
                    busy={starting}
                    onClick={() => {
                      setConfirmBlock(null)
                      beginBlock(nextBlockNumber)
                    }}
                  >
                    {starting ? t.gym.generating : t.gym.yesGenerate(nextBlockNumber)}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirmBlock(null)}>
                    {t.common.cancel}
                  </Button>
                </div>
              ) : (
                <Button variant="primary" block busy={starting} onClick={() => setConfirmBlock(nextBlockNumber)}>
                  {starting
                    ? t.gym.generating
                    : t.gym.startBlockLong(nextBlockNumber, nextBlockNumber === 2, nextBlockNumber === (block.block ?? 1))}
                </Button>
              )}
            </Card>
          )}

          {!block && blockPlans.length > 0 && startBlockControl(planBlock, t.gym.startBlockFromPlan(planBlock))}

          {block && sessions.length > 0 && (
            <Card title={block.name} meta={t.gym.weekOf(blockWeek, block.total_weeks)}>
              <div
                className="block-grid"
                role="group"
                aria-label={t.gym.blockSessionsAria}
                style={{ gridTemplateColumns: `minmax(0, 5.5rem) repeat(${block.total_weeks}, minmax(0, 1fr))` }}
              >
                <span />
                {Array.from({ length: block.total_weeks }, (_, i) => i + 1).map((w) => (
                  <span key={w} className={w === blockWeek ? 'block-grid__week is-now' : 'block-grid__week'}>
                    {w}
                  </span>
                ))}
                {gridSessions
                  .filter((s) => s.week_number === 1)
                  .map((day) => (
                    <div key={day.day_number} className="block-grid__row">
                      <span className="block-grid__label">{day.split_day}</span>
                      {Array.from({ length: block.total_weeks }, (_, i) => i + 1).map((w) => {
                        const s = sessions.find((x) => x.week_number === w && x.day_number === day.day_number)
                        if (!s) return <span key={w} />
                        return (
                          <button
                            key={w}
                            type="button"
                            className={cx('block-grid__cell', s.completed_at && 'is-done', upNext?.id === s.id && 'is-next')}
                            title={t.gym.sessionCellTitle(s.split_day, w, !!s.completed_at)}
                            aria-label={t.gym.sessionCellTitle(s.split_day, w, !!s.completed_at)}
                            onClick={() => setActive(s)}
                          >
                            {s.completed_at ? <Icon name="check" /> : ''}
                          </button>
                        )
                      })}
                    </div>
                  ))}
              </div>
              <p className="hint">{t.gym.tapCellHint}</p>
            </Card>
          )}

          {block && sessions.length > 0 && !blockDone && (
            <Card title={t.gym.flex.title} meta={t.gym.flex.sub}>
              {pendingFlex.length > 0 && (
                <div className="stack stack--tight">
                  <p className="hint">{t.gym.flex.open}</p>
                  {pendingFlex.map((s) => flexRow(s, false))}
                </div>
              )}
              {doneFlex.length > 0 && (
                <Disclosure label={t.gym.flex.past(doneFlex.length)} open={showPastFlex} onToggle={setShowPastFlex}>
                  <div className="stack stack--tight">{doneFlex.map((s) => flexRow(s, true))}</div>
                </Disclosure>
              )}
              <Disclosure
                label={t.gym.flex.generate}
                open={flexToolsOpen}
                onToggle={(open) => {
                  setFlexOpen(open)
                  if (!open) {
                    setFlexPreview(null)
                    setFlexWeekPreview(null)
                    setFlexWeekDays(null)
                  }
                }}
              >
                {!flexPreview ? (
                  <>
                    <p className="hint">{t.gym.flex.subtitle}</p>
                    <Chips
                      label={t.gym.flex.title}
                      value={flexFocus}
                      onChange={setFlexFocus}
                      options={(['upper', 'lower', 'full'] as FlexFocus[]).map((f) => ({ value: f, label: focusLabel(f) }))}
                    />
                    <Chips
                      value={flexLength}
                      onChange={setFlexLength}
                      options={(['short', 'full'] as FlexLength[]).map((l) => ({
                        value: l,
                        label: l === 'short' ? t.gym.flex.short : t.gym.flex.long,
                      }))}
                    />
                    <Button block busy={flexBusy} onClick={() => generateFlex(0)}>
                      {flexBusy ? t.gym.flex.generating : t.gym.flex.generate}
                    </Button>
                  </>
                ) : (
                  <>
                    {flexPreview.needs.length > 0 && (
                      <p className="hint">
                        {t.gym.flex.weekSoFar(
                          flexPreview.needs.map((n) => t.gym.flex.needPart(muscleLabel(n.muscle), n.done, n.weeklyTarget)).join(' · '),
                        )}
                      </p>
                    )}
                    {flexPreview.maintenance && flexPreview.picks.length > 0 && <p className="hint">{t.gym.flex.maintenanceNote}</p>}
                    {injuryNote}
                    {flexPreview.picks.length === 0 ? <p className="hint">{t.gym.flex.nothingFits}</p> : pickRows(flexPreview.picks)}
                    <div className="actions">
                      {flexPreview.picks.length > 0 && (
                        <Button variant="primary" busy={flexBusy} onClick={startFlex}>
                          {flexBusy ? t.gym.flex.generating : t.gym.flex.startIt}
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => generateFlex(flexVariant + 1)} disabled={flexBusy}>
                        {t.gym.flex.anotherMix}
                      </Button>
                      <Button variant="ghost" onClick={() => setFlexPreview(null)} disabled={flexBusy}>
                        {t.gym.flex.discard}
                      </Button>
                    </div>
                  </>
                )}
                {!flexPreview && (
                  <>
                    <p className="hint gym__or">{t.gym.flex.orWeek}</p>
                    <div className="field">
                      <span className="field__label">{t.gym.flex.daysLabel}</span>
                      <Chips
                        label={t.gym.flex.daysLabel}
                        value={flexWeekDays}
                        onChange={generateFlexWeek}
                        disabled={flexBusy}
                        options={[0, 1, 2, 3, 4, 5, 6].map((d) => ({ value: d, label: d }))}
                      />
                    </div>
                    {flexWeekDays === 0 && <p className="hint">{t.gym.flex.weekNote0}</p>}
                    {flexWeekDays === 6 && <p className="hint">{t.gym.flex.weekNote6}</p>}
                    {flexWeekPreview && (
                      <>
                        {flexWeekPreview.needs.length > 0 && (
                          <p className="hint">
                            {t.gym.flex.weekSoFar(
                              flexWeekPreview.needs
                                .map((n) => t.gym.flex.needPart(muscleLabel(n.muscle), n.done, n.weeklyTarget))
                                .join(' · '),
                            )}
                          </p>
                        )}
                        <p className="hint">{t.gym.flex.weekWhy}</p>
                        {injuryNote}
                        {flexWeekPreview.sessions.map((s, i) => (
                          <div key={i} className="stack stack--tight">
                            <h3>
                              {t.gym.flex.dayHeading(i + 1, focusLabel(s.focus))}{' '}
                              <span className="meta">{t.gym.flex.sets(s.picks.reduce((a, p) => a + p.sets, 0))}</span>
                            </h3>
                            {pickRows(s.picks)}
                          </div>
                        ))}
                        <div className="actions">
                          <Button variant="primary" busy={flexBusy} onClick={startFlexWeek}>
                            {flexBusy ? t.gym.flex.generating : t.gym.flex.createWeek(flexWeekPreview.sessions.length)}
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={flexBusy}
                            onClick={() => {
                              setFlexWeekPreview(null)
                              setFlexWeekDays(null)
                            }}
                          >
                            {t.gym.flex.discard}
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}
              </Disclosure>
            </Card>
          )}

          {(review || injuries.length > 0) && (
            <Card title={t.gym.coachTitle} meta={review ? t.gym.coachSub : undefined}>
              {injuries.length > 0 && (
                <p>
                  <Icon name="shield" /> {t.injuries.coachWorkingAround(injuryList(injuries))}
                </p>
              )}
              {review && <p className="gym__advice">{review.advice}</p>}
            </Card>
          )}

          <InjuryCard injuries={injuries} block={block} plans={plans} onChanged={load} />
        </>
      )}

      {view === 'plan' && loaded && (
        <>
          {plans.length === 0 ? (
            setupCard
          ) : (
            <Card
              title={t.gym.thePlan}
              meta={phase ? phase.name : week !== null && week > 6 ? t.gym.deloadSoon : undefined}
              action={
                !editingPlan && (
                  <Button size="sm" onClick={() => setEditingPlan(true)}>
                    {t.common.Edit}
                  </Button>
                )
              }
            >
              {availableBlocks.length > 1 && (
                <div title={editingPlan ? t.gym.saveEditFirst : undefined}>
                  <Chips
                    label={t.gym.thePlan}
                    value={planBlock}
                    disabled={editingPlan}
                    onChange={(b) => {
                      setPlanBlock(b)
                      setSplit(plans.find((p) => p.block === b)?.split_day ?? null)
                    }}
                    options={availableBlocks.map((b) => ({ value: b, label: t.gym.blockBtn(b) }))}
                  />
                </div>
              )}
              {!block && (
                <div className="field">
                  <span className="field__label">{t.gym.weekLabel}</span>
                  <Chips
                    label={t.gym.weekLabel}
                    value={week === null ? null : Math.min(week, 7)}
                    onChange={pickWeek}
                    options={[1, 2, 3, 4, 5, 6, 7].map((w) => ({ value: w, label: w === 7 ? '7+' : w }))}
                  />
                </div>
              )}
              {!editingPlan && (
                <>
                  <div className="field">
                    <span className="field__label">{t.gym.sessionLabel}</span>
                    <Chips
                      label={t.gym.sessionLabel}
                      value={split}
                      onChange={setSplit}
                      options={(split && !rotation.includes(split) ? [...rotation, split] : rotation).map((s) => ({ value: s, label: s }))}
                    />
                  </div>
                  <div className="rows">
                    {splitPlans.map((p) => (
                      <div key={p.id} className="row gym__entry">
                        <div className="row__main">
                          <strong>{p.exercise}</strong>{' '}
                          <span className="mono">{(phase && p.schemes?.[phase.key]) ?? p.schemes?.['1-2'] ?? ''}</span>
                          {p.safety_note && (
                            <p className="hint">
                              <Icon name="shield" /> {p.safety_note}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {splitCardio && <p className="hint">{t.gym.planCardio(splitCardio)}</p>}
                </>
              )}
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
            </Card>
          )}
          {blockPlans.length > 0 && !editingPlan && (!block || block.block !== planBlock) && startBlockControl(planBlock, t.gym.startBlockFromPlan(planBlock))}
        </>
      )}

      {view === 'progress' && loaded && (
        <>
          {((block && volume.size > 0) || showMonth || tuning.changes.length > 0) && (
            <Card title={t.gym.volumePicture} meta={t.gym.hardSetsPerWeek}>
              {block && volume.size > 0 && (
                <div className="volume-grid">
                  {[...volume.entries()].map(([mg, weeks]) => {
                    const max = Math.max(1, ...weeks)
                    const past = weeks.slice(0, blockWeek)
                    const avg = past.length ? Math.round((past.reduce((a, b) => a + b, 0) / past.length) * 10) / 10 : 0
                    return (
                      <div key={mg} className="stack stack--tight">
                        <p className="volume__head">
                          <span className="eyebrow">{muscleLabel(mg)}</span> <span className="meta">{t.gym.avg(avg)}</span>
                        </p>
                        <div className="bars bars--dense" style={{ ['--bars-h' as string]: '44px' }}>
                          {weeks.map((n, i) => {
                            const isNow = i + 1 === blockWeek
                            const future = i + 1 > blockWeek
                            return (
                              <div key={i} className="bars__col" title={t.gym.volumeColTitle(i + 1, n)}>
                                <span className="bars__value">{future ? '' : n}</span>
                                <div className="bars__track volume__track">
                                  <div
                                    className={cx('bars__bar', !isNow && 'bars__bar--muted')}
                                    style={{ height: `${(n / max) * 100}%` }}
                                  />
                                </div>
                                <span className={isNow ? 'bars__label bars__label--now' : 'bars__label'}>{i + 1}</span>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {showMonth && (
                <div className="stack stack--tight volume__section">
                  <h3>{t.gym.lastFourWeeks}</h3>
                  <ol className="rank">
                    {monthVolume.map(([mg, n]) => {
                      // ties share the tag; a flat month (all equal) gets none
                      const tag = monthMax === monthMin ? null : n === monthMax ? 'most' : n === monthMin ? 'least' : null
                      return (
                        <li key={mg} className="rank__row">
                          <span className="rank__label">
                            {muscleLabel(mg)}
                            {tag && (
                              <span className={tag === 'most' ? 'badge badge--good' : 'badge badge--accent'}>
                                {tag === 'most' ? t.gym.mostTrained : t.gym.leastTrained}
                              </span>
                            )}
                          </span>
                          <ProgressBar value={n / monthMax} tone={tag === 'least' ? 'accent' : 'good'} className="progress--thick" />
                          <span className="meta">{t.gym.monthSets(n)}</span>
                          <span className="meta">{t.gym.monthPerWeek(Math.round((n / 4) * 10) / 10)}</span>
                        </li>
                      )
                    })}
                  </ol>
                </div>
              )}
              {(tuning.changes.length > 0 || behind.length > 0) && (
                <div className="stack volume__section">
                  {tuning.changes.length > 0 && (
                    <Disclosure label={t.gym.tune.toggle(tuning.changes.length)} open={showTune} onToggle={setShowTune}>
                      <div className="rows">
                        {tuning.changes.map((c) => (
                          <div key={c.plan.id} className="row tune">
                            <p>
                              <strong>{c.plan.exercise}</strong> <span className="meta">{c.plan.split_day}</span>{' '}
                              <span className={c.delta < 0 ? 'badge badge--accent' : 'badge badge--good'}>
                                {t.gym.tune.change(c.fromSets, c.toSets)}
                              </span>
                            </p>
                            <p className="hint">
                              {c.delta < 0
                                ? t.gym.tune.tooMuch(muscleLabel(c.muscle), c.answers)
                                : t.gym.tune.room(muscleLabel(c.muscle), c.answers, c.perWeek, c.target)}
                            </p>
                            <div className="actions">
                              <Button variant="primary" size="sm" onClick={() => applyTuning(c)} disabled={tuningBusy}>
                                {t.gym.tune.apply}
                              </Button>
                              <Button size="sm" onClick={() => dismissTuning(c)} disabled={tuningBusy}>
                                {t.gym.tune.dismiss}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <p className="hint">{t.gym.tune.footnote}</p>
                    </Disclosure>
                  )}
                  {behind.length > 0 && (
                    <p className="hint">
                      {allBehind
                        ? t.gym.tune.allBehind
                        : t.gym.tune.behind(behind.map((b) => `${muscleLabel(b.muscle)} ${b.perWeek}/${b.target}`).join(' · '))}
                    </p>
                  )}
                </div>
              )}
            </Card>
          )}

          <p className="hint">
            {t.gym.strengthHint}
            <em>{t.gym.strengthHintExample}</em>.
          </p>

          {[...byDate.entries()].map(([date, entries]) => (
            <Card key={date} title={fmtDay(date)} meta={entries[0]?.split_day ?? undefined}>
              <div className="rows">
                {entries.map((log) => (
                  <div key={log.id} className="row gym__entry">
                    <div className="row__main">
                      <strong>{log.exercise}</strong>{' '}
                      <span className="mono">{log.sets?.map((s) => `${s.kg}kg×${s.reps}`).join('  ') ?? ''}</span>
                      {log.notes && <p className="hint">{log.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
          {logs.length === 0 && <EmptyState icon="dumbbell">{t.gym.noFreeform}</EmptyState>}
        </>
      )}

      {view === 'cardio' && loaded && (
        <GymCardio
          cardio={cardio}
          setCardio={setCardio}
          week={week}
          cardioBase={cardioBase}
          onSaveBase={saveCardioBase}
          reload={load}
          injuries={injuries}
        />
      )}

      {blockApply &&
        block &&
        (() => {
          // new split days whose exercises carry no set counts (a rest day):
          // they get no sessions - say so instead of silently doing nothing
          const restSplits = [...new Set(blockApply.added.map((a) => a.split_day))].filter(
            (sd) =>
              !sessions.some((s) => s.split_day === sd) &&
              !blockApply.added.some((a) => a.split_day === sd && setCount(a.schemes?.['1-2']) > 0),
          )
          return (
            <Dialog
              title={
                <>
                  {[
                    blockApply.added.length > 0 ? t.gym.addedList(blockApply.added.map((a) => a.exercise).join(', ')) : null,
                    blockApply.removed.length > 0 ? t.gym.removedList(blockApply.removed.map((r) => r.exercise).join(', ')) : null,
                    blockApply.changed.length > 0 ? t.gym.changedList(blockApply.changed.map((c) => c.exercise).join(', ')) : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  {t.gym.applyPrompt(block.name)}
                </>
              }
              onClose={() => !applying && setBlockApply(null)}
            >
              <p className="hint">{t.gym.applyKeepLogs}</p>
              {restSplits.length > 0 && <p className="hint">{t.gym.noLoggableNote(restSplits.join(', '))}</p>}
              <div className="actions">
                <Button variant="primary" busy={applying} onClick={applyToRunningBlock}>
                  {applying ? t.gym.applying : t.gym.applyToBlock}
                </Button>
                <Button variant="ghost" onClick={() => setBlockApply(null)} disabled={applying}>
                  {t.gym.nextBlockOnly}
                </Button>
              </div>
            </Dialog>
          )
        })()}

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
