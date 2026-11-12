// A plan for the week you actually have. Give it the number of gym days and
// how long a session can be; it lays the days out and shares the sets between
// the muscles. Same thinking as the flexible session (lib/flexSession.ts),
// applied to a standing plan instead of one rescued week:
//  - the layout follows frequency: full-body days at one or two days, then
//    upper/lower, and push/pull/legs only once there are six days to fill;
//  - a session's sets are shared by how much each muscle needs, between 3 and
//    6 hard sets a muscle (under 3 isn't worth setting the machine up for,
//    past 6 the extra sets add fatigue faster than growth);
//  - a muscle that didn't fit one day is first in line the next time its
//    focus comes round, so nothing is left out week after week;
//  - a repeated day (Upper A / Upper B) leads with different lifts.
// Pure planning, no database access: Gym.tsx writes the rows.

import { BUDGET, LOWER_MUSCLES, UPPER_MUSCLES, WEEK_PATTERNS } from './flexSession'
import type { FlexLength } from './flexSession'

export type PlanFocus = 'upper' | 'lower' | 'full' | 'push' | 'pull' | 'legs'

/** How each number of gym days is laid out. One to five days are the flex
 *  composer's own patterns; six is the classic push/pull/legs twice over. */
export const WEEK_LAYOUTS: Record<number, PlanFocus[]> = {
  ...WEEK_PATTERNS,
  6: ['push', 'pull', 'legs', 'push', 'pull', 'legs'],
}

export const MIN_DAYS = 1
export const MAX_DAYS = 6

const SETS_FLOOR = 3
const SETS_CAP = 6

// how much of a session each muscle asks for, relative to the others. The
// order is also the tie-break: when a short day can't hold every muscle, the
// big movers stay and the small ones wait for the next day
const WEIGHT: Record<string, number> = {
  Chest: 1,
  Back: 1,
  Quads: 1,
  Glutes: 0.85,
  Shoulders: 0.8,
  Hamstrings: 0.7,
  Biceps: 0.5,
  Triceps: 0.5,
  Calves: 0.4,
}
const RANK = Object.keys(WEIGHT)
// on a pull day the shoulders are rear-delt work only: a finisher, not a lift
const REAR_DELT_WEIGHT = 0.4

interface LibraryExercise {
  exercise: string
  muscle: string
  compound: boolean
  /** shoulder work only: pressing and side raises go with push days, rear delts with pull */
  side?: 'push' | 'pull'
}

// The same machine, dumbbell and cable movements as the starter plan (so each
// one has a safety cue in every language), compounds first within a muscle.
// Back alternates a pulldown with a row so two picks are never the same line.
const LIBRARY: LibraryExercise[] = [
  { exercise: 'Flat DB Bench Press', muscle: 'Chest', compound: true },
  { exercise: 'Incline DB Bench Press', muscle: 'Chest', compound: true },
  { exercise: 'Pec Deck Fly', muscle: 'Chest', compound: false },
  { exercise: 'Weighted Lat Pulldown', muscle: 'Back', compound: true },
  { exercise: 'Chest-Supported DB Row', muscle: 'Back', compound: true },
  { exercise: 'Close-Grip Pulldown', muscle: 'Back', compound: true },
  { exercise: 'Seated Cable Row', muscle: 'Back', compound: true },
  { exercise: 'Seated DB OHP', muscle: 'Shoulders', compound: true, side: 'push' },
  { exercise: 'Cable Lateral Raise', muscle: 'Shoulders', compound: false, side: 'push' },
  { exercise: 'Face Pull', muscle: 'Shoulders', compound: false, side: 'pull' },
  { exercise: 'Reverse Fly Machine', muscle: 'Shoulders', compound: false, side: 'pull' },
  { exercise: 'Cable Tricep Pushdown', muscle: 'Triceps', compound: false },
  { exercise: 'Overhead Cable Extension', muscle: 'Triceps', compound: false },
  { exercise: 'DB Hammer Curl', muscle: 'Biceps', compound: false },
  { exercise: 'Incline DB Curl', muscle: 'Biceps', compound: false },
  { exercise: 'Leg Press', muscle: 'Quads', compound: true },
  { exercise: 'Hack Squat Machine', muscle: 'Quads', compound: true },
  { exercise: 'Bulgarian Split Squat', muscle: 'Quads', compound: true },
  { exercise: 'Leg Extension', muscle: 'Quads', compound: false },
  { exercise: 'Hip Thrust', muscle: 'Glutes', compound: true },
  { exercise: 'Cable Pull-Through', muscle: 'Glutes', compound: false },
  { exercise: 'Lying Leg Curl', muscle: 'Hamstrings', compound: false },
  { exercise: 'Seated Calf Raise', muscle: 'Calves', compound: false },
]

// reps per phase (weeks 1-2, 3-4, 5-6): the same wave the starter plan rides,
// heavier in the middle and lighter at the end, with the set count held steady
const REPS = {
  compound: { '1-2': '8-10', '3-4': '6-8', '5-6': '12-15' },
  isolation: { '1-2': '12-15', '3-4': '10-12', '5-6': '15-20' },
} as const

export interface BuiltExercise {
  exercise: string
  muscle_group: string
  type: 'Compound' | 'Isolation'
  sets: number
  /** "3 x 8-10" per phase key, ready for workout_plans.schemes */
  schemes: Record<string, string>
}

export interface BuiltDay {
  focus: PlanFocus
  /** 'A', 'B', ... when the focus comes up more than once in the week */
  letter: string | null
  exercises: BuiltExercise[]
  sets: number
}

export interface BuiltPlan {
  days: BuiltDay[]
}

interface BuildOpts {
  /** gym days a week, 1-6 */
  days: number
  length: FlexLength
  /** "try another mix": rotates which lift leads for each muscle */
  variant?: number
}

/** The library exercises a focus may draw on. */
function poolFor(focus: PlanFocus): LibraryExercise[] {
  if (focus === 'upper') return LIBRARY.filter((x) => UPPER_MUSCLES.includes(x.muscle))
  if (focus === 'lower' || focus === 'legs') return LIBRARY.filter((x) => LOWER_MUSCLES.includes(x.muscle))
  if (focus === 'push') return LIBRARY.filter((x) => x.muscle === 'Chest' || x.muscle === 'Triceps' || x.side === 'push')
  if (focus === 'pull') return LIBRARY.filter((x) => x.muscle === 'Back' || x.muscle === 'Biceps' || x.side === 'pull')
  return LIBRARY
}

/** Share a session's sets between its muscles. `want` is each muscle's
 *  relative claim; the result is whole sets, 3 to 6 a muscle, never more in
 *  total than the slot holds. Muscles that don't fit are left out (the caller
 *  moves them up the queue for next time). */
function allocate(want: Map<string, number>, budget: number): Map<string, number> {
  const ranked = [...want.keys()].sort((a, b) => want.get(b)! - want.get(a)! || RANK.indexOf(a) - RANK.indexOf(b))
  const kept = ranked.slice(0, Math.floor(budget / SETS_FLOOR))
  const doses = new Map<string, number>()
  if (kept.length === 0) return doses
  const total = kept.reduce((a, m) => a + want.get(m)!, 0)
  // fill the slot, but the hungriest muscle stops at the cap and the others
  // stay in proportion to it - a three-muscle push day is not padded to 18
  const scale = Math.min(budget / total, SETS_CAP / want.get(kept[0])!)
  const ideal = (m: string) => want.get(m)! * scale
  for (const m of kept) doses.set(m, Math.min(SETS_CAP, Math.max(SETS_FLOOR, Math.round(ideal(m)))))
  const sum = () => [...doses.values()].reduce((a, n) => a + n, 0)
  // the floor and rounding can overshoot: give back from whoever was rounded up most
  while (sum() > budget) {
    const over = kept.filter((m) => doses.get(m)! > SETS_FLOOR).sort((a, b) => doses.get(b)! - ideal(b) - (doses.get(a)! - ideal(a)))[0]
    if (!over) break
    doses.set(over, doses.get(over)! - 1)
  }
  // ...and rounding down can leave a set on the table
  while (sum() < budget) {
    const under = kept
      .filter((m) => doses.get(m)! < SETS_CAP && doses.get(m)! < ideal(m))
      .sort((a, b) => ideal(b) - doses.get(b)! - (ideal(a) - doses.get(a)!))[0]
    if (!under) break
    doses.set(under, doses.get(under)! + 1)
  }
  // a day with few muscles (push, pull) still has room: the ones sitting on
  // the floor take one set more, smallest first - arms on a push/pull split
  for (const m of [...kept].reverse()) {
    if (sum() >= budget) break
    if (doses.get(m) === SETS_FLOOR) doses.set(m, SETS_FLOOR + 1)
  }
  return doses
}

function toExercise(x: LibraryExercise, sets: number): BuiltExercise {
  const reps = x.compound ? REPS.compound : REPS.isolation
  return {
    exercise: x.exercise,
    muscle_group: x.muscle,
    type: x.compound ? 'Compound' : 'Isolation',
    sets,
    schemes: Object.fromEntries(Object.entries(reps).map(([phase, r]) => [phase, `${sets} x ${r}`])),
  }
}

/** The lifts for one muscle's share of a session. A compound leads when the
 *  muscle has one; five sets or more split over two movements, the second an
 *  isolation where there is one (repeating one heavy lift past four sets
 *  trades stimulus for fatigue). */
function pick(options: LibraryExercise[], sets: number, turn: number): BuiltExercise[] {
  const compounds = options.filter((x) => x.compound)
  const isolations = options.filter((x) => !x.compound)
  const leads = compounds.length > 0 ? compounds : isolations
  const lead = leads[turn % leads.length]
  const others = options.filter((x) => x !== lead)
  if (sets < 5 || others.length === 0) return [toExercise(lead, sets)]
  const seconds = lead.compound && isolations.length > 0 ? isolations : others
  const second = seconds[turn % seconds.length]
  const first = Math.ceil(sets / 2)
  return [toExercise(lead, first), toExercise(second, sets - first)]
}

/** Lay out a whole training week. Deterministic: the same answers always give
 *  the same plan, and `variant` steps through the alternatives. */
export function buildPlan(opts: BuildOpts): BuiltPlan {
  const count = Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(opts.days)))
  const layout = WEEK_LAYOUTS[count]
  const budget = BUDGET[opts.length]
  const variant = opts.variant ?? 0
  const repeats = (focus: PlanFocus) => layout.filter((f) => f === focus).length
  const seen = new Map<PlanFocus, number>()
  // what a muscle is still owed from days it was left out of
  const owed = new Map<string, number>()

  const days = layout.map((focus) => {
    const nth = seen.get(focus) ?? 0
    seen.set(focus, nth + 1)
    const pool = poolFor(focus)
    const muscles = RANK.filter((m) => pool.some((x) => x.muscle === m))
    const share = (m: string) => (focus === 'pull' && m === 'Shoulders' ? REAR_DELT_WEIGHT : WEIGHT[m])
    const doses = allocate(new Map(muscles.map((m) => [m, share(m) + (owed.get(m) ?? 0)])), budget)
    for (const m of muscles) owed.set(m, doses.has(m) ? 0 : (owed.get(m) ?? 0) + share(m))

    // biggest share first, then compounds ahead of isolations: the lifts that
    // need the most from you come while you are fresh
    const exercises = [...doses.entries()]
      .sort((a, b) => b[1] - a[1] || RANK.indexOf(a[0]) - RANK.indexOf(b[0]))
      .flatMap(([m, sets]) => pick(pool.filter((x) => x.muscle === m), sets, nth + variant))
    exercises.sort((a, b) => Number(b.type === 'Compound') - Number(a.type === 'Compound'))

    return {
      focus,
      letter: repeats(focus) > 1 ? String.fromCharCode(65 + nth) : null,
      exercises,
      sets: exercises.reduce((a, x) => a + x.sets, 0),
    }
  })
  return { days }
}

/** The plan as workout_plans rows for one block. `names` are the session
 *  names, one per day, in order; `cues` the language pack's safety cues. */
export function planRows(plan: BuiltPlan, block: number, names: string[], cues: Record<string, string>) {
  let order = 0
  return plan.days.flatMap((day, i) =>
    day.exercises.map((x) => ({
      block,
      split_day: names[i],
      sort_order: ++order,
      exercise: x.exercise,
      type: x.type,
      safety_note: cues[x.exercise] ?? null,
      muscle_group: x.muscle_group,
      schemes: x.schemes,
      cardio: null,
    })),
  )
}
