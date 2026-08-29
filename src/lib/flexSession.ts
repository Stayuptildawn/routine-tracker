// Flexible sessions: when life cuts a 6-day week down to 3 - or 1 - the
// planned split stops fitting. This composes a one-off upper/lower/full-body
// day from what the week still needs: the user's own plan sets the weekly
// per-muscle targets, the last 7 days of logs say what's already done, and
// the recovery check-ins nudge the totals. The evidence behind the numbers:
// ~2/3 of the growth stimulus of a muscle-session lands in the first 4-8 hard
// sets (so per-session doses are capped), weekly volume - not the exact split
// - drives hypertrophy, and ~1/3 of normal volume maintains, which is what
// the "week already covered" fallback provides.

import { supabase } from './supabase'
import { setCount } from './blocks'
import type { PlannedSession, TrainingBlock, WorkoutPlan } from './types'

export const UPPER_MUSCLES = ['Chest', 'Shoulders', 'Triceps', 'Back', 'Biceps']
export const LOWER_MUSCLES = ['Quads', 'Hamstrings', 'Glutes', 'Calves']

export type FlexFocus = 'upper' | 'lower' | 'full'
export type FlexLength = 'short' | 'full'

// total hard sets that fit the slot (with warm-ups and rests, ~45 / ~75 min)
const BUDGET: Record<FlexLength, number> = { short: 12, full: 18 }
// past ~6 hard sets per muscle in one session the stimulus flattens off
const PER_MUSCLE_CAP = 6
// fewer than 2 sets isn't worth the equipment swap
const PER_MUSCLE_FLOOR = 2
// maintenance dose when the week's targets are already met
const MAINTENANCE_SETS = 2

/** Flex sessions live outside the weekly grid; a high day_number marks them
 *  (no migration needed - regular splits count their days from 1). */
export const FLEX_DAY_BASE = 90
export const isFlex = (s: { day_number: number }) => s.day_number >= FLEX_DAY_BASE

export interface FlexPick {
  exercise: string
  muscle_group: string
  sets: number
  target_scheme: string | null
}

export interface MuscleNeed {
  muscle: string
  /** sets/week the plan intends for this muscle at the current phase */
  weeklyTarget: number
  /** hard sets actually logged in the trailing 7 days */
  done: number
}

export interface FlexComposition {
  picks: FlexPick[]
  /** the needs that drove the choice, sorted as used - for the preview line */
  needs: MuscleNeed[]
  /** true = weekly targets were already met, this is a maintenance dose */
  maintenance: boolean
}

interface ComposeOpts {
  /** the active block's plan rows, all splits */
  plans: WorkoutPlan[]
  /** phase key for the current block week ('1-2' | '3-4' | '5-6') */
  phase: string
  needs: MuscleNeed[]
  /** recovery check-in tweaks per muscle, ±1 (see recoveryAdjustments) */
  adjustments?: Map<string, number>
  focus: FlexFocus
  length: FlexLength
  /** "try another mix" - rotates which of a muscle's exercises lead */
  variant?: number
}

const repsPart = (scheme: string | null | undefined): string => {
  const m = scheme?.match(/^\s*\d+\s*[x×]\s*(.*)$/i)
  return m?.[1]?.trim() || '8-12'
}

/** Pure planning: which exercises, how many sets, at what target. */
export function composeFlexSession(opts: ComposeOpts): FlexComposition {
  const { plans, phase, needs, adjustments, focus, length } = opts
  const variant = opts.variant ?? 0
  const focusMuscles = focus === 'upper' ? UPPER_MUSCLES : focus === 'lower' ? LOWER_MUSCLES : [...UPPER_MUSCLES, ...LOWER_MUSCLES]

  // exercises available per muscle, in plan order across all splits - the
  // plan lists compounds first within a split, so "first" is a sane default
  const pool = new Map<string, WorkoutPlan[]>()
  for (const p of plans) {
    if (!p.muscle_group || !focusMuscles.includes(p.muscle_group)) continue
    if (setCount(p.schemes?.[phase]) === 0) continue // rest-day rows etc.
    const list = pool.get(p.muscle_group) ?? []
    if (!list.some((x) => x.exercise === p.exercise)) list.push(p)
    pool.set(p.muscle_group, list)
  }

  // deficit per muscle = (weekly target ± check-in tweak) - done this week
  const scored = needs
    .filter((n) => pool.has(n.muscle))
    .map((n) => ({
      ...n,
      deficit: Math.max(0, n.weeklyTarget + (adjustments?.get(n.muscle) ?? 0) - n.done),
    }))
    .sort((a, b) => b.deficit - a.deficit || b.weeklyTarget - a.weeklyTarget || a.muscle.localeCompare(b.muscle))

  const maintenance = !scored.some((n) => n.deficit >= PER_MUSCLE_FLOOR)
  let budget = BUDGET[length]
  const picks: FlexPick[] = []
  const picked = new Set<string>()

  const allocate = (muscle: string, dose: number) => {
    budget -= dose
    picked.add(muscle)
    const options = pool.get(muscle)!
    const lead = options[variant % options.length]
    // a big dose splits across two different movements - repeated heavy sets
    // of one lift past ~4 trade stimulus for junk fatigue
    const second = dose >= 5 && options.length > 1 ? options[(variant + 1) % options.length] : null
    if (second) {
      const firstSets = Math.ceil(dose / 2)
      picks.push(toPick(lead, muscle, firstSets, phase))
      picks.push(toPick(second, muscle, dose - firstSets, phase))
    } else {
      picks.push(toPick(lead, muscle, dose, phase))
    }
  }

  // first pass: the real deficits. When they don't all fit the budget, scale
  // everyone down proportionally instead of letting the big muscles starve
  // the small ones - when volume must drop, the evidence says cut it across
  // the board and keep each muscle above a maintenance floor, not zero out
  // the tail of the priority list.
  const wants = scored
    .filter((n) => n.deficit >= PER_MUSCLE_FLOOR)
    .map((n) => ({ muscle: n.muscle, want: Math.min(n.deficit, PER_MUSCLE_CAP) }))
  const totalWant = wants.reduce((a, w) => a + w.want, 0)
  const scale = totalWant > budget ? budget / totalWant : 1
  const doses = new Map<string, number>()
  let spent = 0
  for (const w of wants) {
    if (budget - spent < PER_MUSCLE_FLOOR) break
    const dose = Math.min(Math.max(PER_MUSCLE_FLOOR, Math.floor(w.want * scale)), w.want, budget - spent)
    doses.set(w.muscle, dose)
    spent += dose
  }
  // rounding leftovers go back one set at a time, biggest deficits first
  let gave = true
  while (spent < budget && gave) {
    gave = false
    for (const w of wants) {
      if (spent >= budget) break
      const d = doses.get(w.muscle)
      if (d != null && d < w.want) {
        doses.set(w.muscle, d + 1)
        spent++
        gave = true
      }
    }
  }
  for (const [muscle, dose] of doses) allocate(muscle, dose)
  // second pass: leftover budget tops up the rest of the focus with a
  // maintenance dose, so "a full upper day" never shrinks to one lagging
  // muscle (and a fully covered week still yields a keep-it-ticking session)
  for (const n of scored) {
    if (budget < MAINTENANCE_SETS) break
    if (picked.has(n.muscle)) continue
    allocate(n.muscle, MAINTENANCE_SETS)
  }

  return { picks, needs: scored, maintenance }
}

/** How a reduced week is laid out. The logic: with 1-2 days, full-body wins -
 *  every muscle gets touched every visit, and per-muscle frequency (>=2x/week
 *  when volume allows) beats cramming one big day. 3 days = Upper/Lower/Full
 *  so everything is still hit twice. 4-5 days alternate Upper/Lower (each
 *  half 2x), the fifth day sweeping leftovers as full-body. 6 days is the
 *  written plan itself - no flex layout needed. */
export const WEEK_PATTERNS: Record<number, FlexFocus[]> = {
  1: ['full'],
  2: ['full', 'full'],
  3: ['upper', 'lower', 'full'],
  4: ['upper', 'lower', 'upper', 'lower'],
  5: ['upper', 'lower', 'upper', 'lower', 'full'],
}

export interface FlexWeekPlan {
  sessions: { focus: FlexFocus; picks: FlexPick[]; maintenance: boolean }[]
  /** the week-start needs the layout was planned from */
  needs: MuscleNeed[]
}

interface ComposeWeekOpts {
  plans: WorkoutPlan[]
  phase: string
  needs: MuscleNeed[]
  adjustments?: Map<string, number>
  /** gym days available this week, 1-5 (0 and 6 need no layout) */
  days: number
  length: FlexLength
}

/** Lay out a whole reduced week: each day is composed by the single-session
 *  planner, and its sets are fed forward as "done" so the next day plans the
 *  remainder - the weekly targets are divided, never double-counted. */
export function composeFlexWeek(opts: ComposeWeekOpts): FlexWeekPlan {
  const pattern = WEEK_PATTERNS[Math.min(5, Math.max(1, Math.round(opts.days)))]
  const rolling = opts.needs.map((n) => ({ ...n }))
  const sessions: FlexWeekPlan['sessions'] = []
  pattern.forEach((focus, i) => {
    const r = composeFlexSession({
      plans: opts.plans,
      phase: opts.phase,
      needs: rolling,
      adjustments: opts.adjustments,
      focus,
      length: opts.length,
      variant: i, // later days lead with different exercises
    })
    sessions.push({ focus, picks: r.picks, maintenance: r.maintenance })
    for (const p of r.picks) {
      const n = rolling.find((x) => x.muscle === p.muscle_group)
      if (n) n.done += p.sets
    }
  })
  return { sessions, needs: opts.needs }
}

/** Write a whole planned week of flex sessions, in order. */
export async function createFlexWeek(
  block: TrainingBlock,
  weekNumber: number,
  existing: PlannedSession[],
  week: FlexWeekPlan,
  names: string[],
): Promise<PlannedSession[]> {
  const acc = [...existing]
  const out: PlannedSession[] = []
  for (let i = 0; i < week.sessions.length; i++) {
    const s = await createFlexSession(block, weekNumber, acc, week.sessions[i].picks, names[i])
    acc.push(s)
    out.push(s)
  }
  return out
}

function toPick(plan: WorkoutPlan, muscle: string, sets: number, phase: string): FlexPick {
  return {
    exercise: plan.exercise,
    muscle_group: muscle,
    sets,
    target_scheme: `${sets} x ${repsPart(plan.schemes?.[phase])}`,
  }
}

/** Write the composed session + sets; returns the session row ready to open.
 *  It joins the running block (so the volume picture and the weekly coach
 *  note count it) but sits outside the grid via its day_number. */
export async function createFlexSession(
  block: TrainingBlock,
  weekNumber: number,
  existing: PlannedSession[],
  picks: FlexPick[],
  name: string,
): Promise<PlannedSession> {
  const day = Math.max(FLEX_DAY_BASE - 1, ...existing.map((s) => s.day_number)) + 1
  const { data: session, error } = await supabase
    .from('planned_sessions')
    .insert({ block_id: block.id, week_number: weekNumber, day_number: day, split_day: name, cardio: null })
    .select('*')
    .single()
  if (error) throw error
  const sets: Record<string, unknown>[] = []
  let order = 0
  for (const p of picks) {
    for (let n = 1; n <= p.sets; n++) {
      sets.push({
        session_id: session.id,
        sort_order: ++order,
        exercise: p.exercise,
        muscle_group: p.muscle_group,
        set_number: n,
        target_scheme: p.target_scheme,
      })
    }
  }
  const { error: setErr } = await supabase.from('planned_sets').insert(sets)
  if (setErr) throw setErr
  return session as PlannedSession
}
