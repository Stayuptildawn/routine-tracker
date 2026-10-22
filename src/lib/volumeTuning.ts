import { checkinAdjustments, setCount } from './blocks'
import { exerciseRisk } from './injuryPlan'
import type { BodyPart, Severity } from './injuryPlan'
import type { WorkoutPlan } from './types'

// Plan tuning from the volume picture: reads the last four weeks of hard
// sets against what the plan prescribes, plus the after-session check-ins,
// and proposes at most a few ±1-set changes the user can apply with a tap.
// Fixed rules, no AI - the same data always gives the same answer:
//   - check-ins netting "too much"  -> one set fewer (wins over everything)
//   - check-ins netting "room" AND the planned work is actually being done
//     -> one set more, never on an exercise an active injury puts at risk
//   - a muscle far behind its plan because sessions were skipped gets a
//     note instead: more sets on paper can't fix missed days
// Only check-ins newer than the last tuning of a muscle count, so applying
// (or dismissing) a change never re-triggers the same suggestion.

export const PHASE_KEYS = ['1-2', '3-4', '5-6'] as const

/** Never trim an exercise below this, never grow it past MAX_SETS. */
const MIN_SETS = 2
const MAX_SETS = 6
/** Share of the planned weekly sets that must be logged before "add a set". */
const ADD_COMPLIANCE = 0.8
/** Below this share a muscle counts as behind (sessions skipped). */
const BEHIND_COMPLIANCE = 0.5
const MAX_CHANGES = 3

export interface TuningCheckin {
  muscle_group: string
  amount: string | null
  created_at: string
}

export interface TuningInput {
  /** the plan rows the suggestions edit (one block) */
  plans: WorkoutPlan[]
  /** current phase key - the weekly target is read from it */
  phase: string
  /** hard sets logged per muscle over the window */
  loggedSets: Map<string, number>
  /** weeks the window covers (up to 4; a young block has fewer). Under one
   *  week there's too little logging to judge: only easing off is offered */
  weeks: number
  /** recovery check-ins of the last ~60 days */
  checkins: TuningCheckin[]
  /** when each muscle was last tuned (applied or dismissed), ISO */
  lastTuned: Map<string, string>
  injuries: { body_part: BodyPart; severity: Severity }[]
}

export interface Tuning {
  muscle: string
  delta: 1 | -1
  plan: WorkoutPlan
  fromSets: number
  toSets: number
  /** the plan row's schemes with the change made from `phase` on */
  schemes: Record<string, string>
  /** answers behind it: "too much" (over the line + stretch) or "room" */
  answers: number
  /** logged vs planned hard sets per week, rounded to 0.1 */
  perWeek: number
  target: number
}

export interface BehindNote {
  muscle: string
  perWeek: number
  target: number
}

export interface TuningResult {
  changes: Tuning[]
  behind: BehindNote[]
  /** muscles the plan trains this phase - when all of them are behind,
   *  it's fewer sessions overall rather than any one muscle */
  planned: number
}

const r1 = (n: number) => Math.round(n * 10) / 10

/** "4 x 8-10" -> "3 x 8-10": the set count is the leading number. */
export function withSetCount(scheme: string, n: number): string {
  return scheme.replace(/^\s*\d+/, String(n))
}

/** The same ±1 on the current phase and every later one (earlier phases are
 *  history - editing them changes nothing that's still ahead). */
function shiftSchemes(schemes: Record<string, string>, phase: string, delta: number): Record<string, string> {
  const from = Math.max(0, PHASE_KEYS.indexOf(phase as (typeof PHASE_KEYS)[number]))
  const next = { ...schemes }
  for (const key of PHASE_KEYS.slice(from)) {
    const n = setCount(next[key])
    if (n > 0) next[key] = withSetCount(next[key], Math.min(MAX_SETS, Math.max(MIN_SETS, n + delta)))
  }
  return next
}

export function suggestTunings(input: TuningInput): TuningResult {
  const { plans, phase, loggedSets, checkins, lastTuned, injuries } = input
  const weeks = Math.max(1, Math.min(4, input.weeks))
  const tooEarly = input.weeks < 1

  // weekly target per muscle at this phase, and which rows train it
  const target = new Map<string, number>()
  const rowsOf = new Map<string, WorkoutPlan[]>()
  for (const p of plans) {
    const n = setCount(p.schemes?.[phase])
    if (!p.muscle_group || p.muscle_group === 'Other' || n === 0) continue
    target.set(p.muscle_group, (target.get(p.muscle_group) ?? 0) + n)
    rowsOf.set(p.muscle_group, [...(rowsOf.get(p.muscle_group) ?? []), p])
  }

  // check-ins since each muscle was last tuned
  const fresh = checkins.filter((c) => {
    const tuned = lastTuned.get(c.muscle_group)
    return !tuned || c.created_at > tuned
  })
  const adjust = checkinAdjustments(fresh)
  const answers = (muscle: string, kinds: string[]) =>
    fresh.filter((c) => c.muscle_group === muscle && c.amount && kinds.includes(c.amount)).length

  const changes: Tuning[] = []
  const behind: BehindNote[] = []
  for (const [muscle, weekly] of target) {
    const perWeek = r1((loggedSets.get(muscle) ?? 0) / weeks)
    const compliance = perWeek / weekly
    const rows = rowsOf.get(muscle) ?? []
    const dir = adjust.get(muscle)
    const sets = (p: WorkoutPlan) => setCount(p.schemes?.[phase])

    if (dir === -1) {
      // trim the exercise carrying the most sets (later in the session on a
      // tie - the earlier one is usually the main lift)
      const pick = rows
        .filter((p) => sets(p) > MIN_SETS)
        .sort((a, b) => sets(b) - sets(a) || (b.sort_order ?? 0) - (a.sort_order ?? 0))[0]
      if (pick) {
        changes.push({
          muscle, delta: -1, plan: pick, fromSets: sets(pick), toSets: sets(pick) - 1,
          schemes: shiftSchemes(pick.schemes ?? {}, phase, -1),
          answers: answers(muscle, ['over_the_line', 'stretch']), perWeek, target: weekly,
        })
      }
      continue
    }

    if (tooEarly) continue

    if (compliance < BEHIND_COMPLIANCE) {
      behind.push({ muscle, perWeek, target: weekly })
      continue
    }

    if (dir === 1 && compliance >= ADD_COMPLIANCE) {
      // grow the lightest exercise, isolation first - an extra set of a
      // raise is a smaller step than one more heavy compound set
      const pick = rows
        .filter((p) => sets(p) < MAX_SETS && !injuries.some((i) => exerciseRisk(p.exercise, p.muscle_group, i.body_part)))
        .sort(
          (a, b) =>
            Number(b.type === 'Isolation') - Number(a.type === 'Isolation') ||
            sets(a) - sets(b) ||
            (b.sort_order ?? 0) - (a.sort_order ?? 0),
        )[0]
      if (pick) {
        changes.push({
          muscle, delta: 1, plan: pick, fromSets: sets(pick), toSets: sets(pick) + 1,
          schemes: shiftSchemes(pick.schemes ?? {}, phase, 1),
          answers: answers(muscle, ['could_take_more']), perWeek, target: weekly,
        })
      }
    }
  }

  // easing off comes first: it's the safety-relevant half
  changes.sort((a, b) => a.delta - b.delta || b.answers - a.answers)
  behind.sort((a, b) => a.perWeek / a.target - b.perWeek / b.target)
  return { changes: changes.slice(0, MAX_CHANGES), behind, planned: target.size }
}
