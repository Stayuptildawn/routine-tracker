import { describe, it, expect, vi } from 'vitest'
import type { WorkoutPlan } from '../src/lib/types'

vi.mock('../src/lib/supabase', () => ({ supabase: {} }))
const { suggestTunings, withSetCount } = await import('../src/lib/volumeTuning')
type TuningInput = Parameters<typeof suggestTunings>[0]

const plan = (exercise: string, muscle: string, sets: number, type = 'Compound', sort = 1): WorkoutPlan => ({
  id: exercise,
  block: 1,
  split_day: 'A',
  sort_order: sort,
  exercise,
  type,
  safety_note: null,
  schemes: { '1-2': `${sets} x 8-10`, '3-4': `${sets} x 6`, '5-6': `${sets} x 12-15` },
  cardio: null,
  muscle_group: muscle,
})

const PLANS = [
  plan('Row', 'Back', 4, 'Compound', 1),
  plan('Pulldown', 'Back', 3, 'Compound', 2),
  plan('Bench', 'Chest', 4, 'Compound', 1),
  plan('Pec Deck', 'Chest', 3, 'Isolation', 2),
  plan('Leg Press', 'Quads', 4, 'Compound', 1),
  plan('Calf Raise', 'Calves', 3, 'Isolation', 2),
]

const ci = (muscle: string, amount: string, daysAgo = 3) => ({
  muscle_group: muscle,
  amount,
  created_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
})

const base = (over: Partial<TuningInput> = {}): TuningInput => ({
  plans: PLANS,
  phase: '1-2',
  // 4 weeks at plan: Back 7/wk, Chest 7/wk, Quads 4/wk, Calves 3/wk
  loggedSets: new Map([['Back', 28], ['Chest', 28], ['Quads', 16], ['Calves', 12]]),
  weeks: 4,
  checkins: [],
  lastTuned: new Map(),
  injuries: [],
  ...over,
})

describe('withSetCount', () => {
  it('swaps only the leading set count', () => {
    expect(withSetCount('4 x 8-10', 3)).toBe('3 x 8-10')
    expect(withSetCount('3 x 12-15', 4)).toBe('4 x 12-15')
  })
})

describe('suggestTunings', () => {
  it('suggests nothing without check-in signal', () => {
    expect(suggestTunings(base()).changes).toEqual([])
  })

  it('"too much" trims the heaviest exercise, this phase on', () => {
    const r = suggestTunings(base({ phase: '3-4', checkins: [ci('Back', 'over_the_line'), ci('Back', 'stretch'), ci('Back', 'right')] }))
    expect(r.changes).toHaveLength(1)
    const c = r.changes[0]
    expect(c).toMatchObject({ muscle: 'Back', delta: -1, fromSets: 4, toSets: 3, answers: 2 })
    expect(c.plan.exercise).toBe('Row')
    // the earlier phase is history and stays as written
    expect(c.schemes).toEqual({ '1-2': '4 x 8-10', '3-4': '3 x 6', '5-6': '3 x 12-15' })
  })

  it('never trims below 2 sets', () => {
    const plans = [plan('Curl', 'Biceps', 2)]
    const r = suggestTunings(base({ plans, loggedSets: new Map([['Biceps', 8]]), checkins: [ci('Biceps', 'over_the_line'), ci('Biceps', 'over_the_line')] }))
    expect(r.changes).toEqual([])
  })

  it('"room" adds a set to the isolation exercise when the work is being done', () => {
    const r = suggestTunings(base({ checkins: [ci('Chest', 'could_take_more'), ci('Chest', 'could_take_more')] }))
    expect(r.changes).toHaveLength(1)
    expect(r.changes[0]).toMatchObject({ muscle: 'Chest', delta: 1, fromSets: 3, toSets: 4 })
    expect(r.changes[0].plan.exercise).toBe('Pec Deck')
  })

  it('no extra set when the planned sets are not being logged', () => {
    const r = suggestTunings(base({
      loggedSets: new Map([['Back', 28], ['Chest', 16], ['Quads', 16], ['Calves', 12]]), // Chest 4 of 7 a week
      checkins: [ci('Chest', 'could_take_more'), ci('Chest', 'could_take_more')],
    }))
    expect(r.changes).toEqual([])
  })

  it('a skipped muscle gets a note, not a change', () => {
    const r = suggestTunings(base({ loggedSets: new Map([['Back', 28], ['Chest', 28], ['Quads', 0], ['Calves', 0]]) }))
    expect(r.changes).toEqual([])
    expect(r.behind.map((b) => b.muscle).sort()).toEqual(['Calves', 'Quads'])
    expect(r.behind[0]).toMatchObject({ perWeek: 0 })
  })

  it('check-ins from before the last tuning no longer count', () => {
    const checkins = [ci('Back', 'over_the_line', 10), ci('Back', 'over_the_line', 9)]
    const tuned = new Date(Date.now() - 5 * 86400000).toISOString()
    expect(suggestTunings(base({ checkins })).changes).toHaveLength(1)
    expect(suggestTunings(base({ checkins, lastTuned: new Map([['Back', tuned]]) })).changes).toEqual([])
  })

  it('no extra set on an exercise an active injury puts at risk', () => {
    const plans = [plan('Leg Press', 'Quads', 3, 'Compound'), plan('Leg Extension', 'Quads', 3, 'Isolation')]
    const r = suggestTunings(base({
      plans,
      loggedSets: new Map([['Quads', 24]]),
      checkins: [ci('Quads', 'could_take_more'), ci('Quads', 'could_take_more')],
      injuries: [{ body_part: 'knee', severity: 'moderate' }],
    }))
    expect(r.changes).toEqual([])
  })

  it('in the first days of a block only easing off is offered', () => {
    const r = suggestTunings(base({
      weeks: 0.4,
      loggedSets: new Map([['Back', 3], ['Chest', 2]]),
      checkins: [ci('Chest', 'could_take_more'), ci('Chest', 'could_take_more'), ci('Back', 'over_the_line'), ci('Back', 'over_the_line')],
    }))
    expect(r.changes.map((c) => [c.muscle, c.delta])).toEqual([['Back', -1]])
    expect(r.behind).toEqual([])
  })

  it('easing off is listed before adding', () => {
    const r = suggestTunings(base({
      checkins: [ci('Chest', 'could_take_more'), ci('Chest', 'could_take_more'), ci('Back', 'over_the_line'), ci('Back', 'over_the_line')],
    }))
    expect(r.changes.map((c) => c.delta)).toEqual([-1, 1])
  })
})
