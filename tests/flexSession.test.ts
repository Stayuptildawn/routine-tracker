import { describe, it, expect } from 'vitest'
import { composeFlexSession, isFlex, FLEX_DAY_BASE } from '../src/lib/flexSession'
import type { MuscleNeed } from '../src/lib/flexSession'
import type { WorkoutPlan } from '../src/lib/types'

const plan = (exercise: string, muscle: string, scheme = '3 x 8-12', split = 'A'): WorkoutPlan => ({
  id: exercise,
  block: 1,
  split_day: split,
  sort_order: 1,
  exercise,
  type: null,
  safety_note: null,
  schemes: { '1-2': scheme, '3-4': scheme, '5-6': scheme },
  cardio: null,
  muscle_group: muscle,
})

const need = (muscle: string, weeklyTarget: number, done: number): MuscleNeed => ({ muscle, weeklyTarget, done })

const PLANS = [
  plan('Bench', 'Chest', '3 x 8-12'),
  plan('Pec Deck', 'Chest', '3 x 12-15', 'B'),
  plan('Row', 'Back', '4 x 8-10'),
  plan('Pulldown', 'Back', '3 x 10-12', 'B'),
  plan('Lateral Raise', 'Shoulders', '3 x 12-15'),
  plan('Leg Press', 'Quads', '3 x 10-12', 'C'),
  plan('Leg Curl', 'Hamstrings', '3 x 10-12', 'C'),
]

const totalSets = (r: ReturnType<typeof composeFlexSession>) => r.picks.reduce((a, p) => a + p.sets, 0)

describe('composeFlexSession', () => {
  it('prioritizes the biggest weekly deficit', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 10, 8), need('Back', 12, 2)],
      focus: 'upper',
      length: 'full',
    })
    expect(r.picks[0].muscle_group).toBe('Back')
    expect(r.maintenance).toBe(false)
  })

  it('keeps only focus muscles', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 10, 0), need('Quads', 10, 0), need('Hamstrings', 10, 0)],
      focus: 'lower',
      length: 'full',
    })
    expect(r.picks.every((p) => ['Quads', 'Hamstrings', 'Glutes', 'Calves'].includes(p.muscle_group))).toBe(true)
    expect(r.picks.some((p) => p.muscle_group === 'Quads')).toBe(true)
  })

  it('never exceeds the session budget', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 20, 0), need('Back', 20, 0), need('Shoulders', 20, 0)],
      focus: 'upper',
      length: 'short',
    })
    expect(totalSets(r)).toBeLessThanOrEqual(12)
  })

  it('caps a single muscle per session and splits big doses across two lifts', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Back', 20, 0)],
      focus: 'upper',
      length: 'full',
    })
    const backPicks = r.picks.filter((p) => p.muscle_group === 'Back')
    expect(backPicks.reduce((a, p) => a + p.sets, 0)).toBeLessThanOrEqual(6)
    expect(backPicks.length).toBe(2)
    expect(new Set(backPicks.map((p) => p.exercise)).size).toBe(2)
  })

  it('falls back to a maintenance dose when the week is covered', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 6, 6), need('Back', 7, 7)],
      focus: 'upper',
      length: 'short',
    })
    expect(r.maintenance).toBe(true)
    expect(r.picks.length).toBeGreaterThan(0)
    expect(r.picks.every((p) => p.sets === 2)).toBe(true)
  })

  it('tops up untouched focus muscles after covering deficits', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 10, 0), need('Back', 8, 8), need('Shoulders', 6, 6)],
      focus: 'upper',
      length: 'full',
    })
    expect(r.picks.some((p) => p.muscle_group === 'Back' && p.sets === 2)).toBe(true)
    expect(r.picks.some((p) => p.muscle_group === 'Shoulders' && p.sets === 2)).toBe(true)
  })

  it('recovery adjustments shift the target', () => {
    const base = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 4, 2)],
      focus: 'upper',
      length: 'full',
    })
    const adjusted = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Chest', 4, 2)],
      adjustments: new Map([['Chest', 1]]),
      focus: 'upper',
      length: 'full',
    })
    const chestSets = (r: typeof base) =>
      r.picks.filter((p) => p.muscle_group === 'Chest').reduce((a, p) => a + p.sets, 0)
    expect(chestSets(adjusted)).toBe(chestSets(base) + 1)
  })

  it('writes the real set count into the target scheme', () => {
    const r = composeFlexSession({
      plans: PLANS,
      phase: '1-2',
      needs: [need('Shoulders', 4, 0)],
      focus: 'upper',
      length: 'full',
    })
    const sh = r.picks.find((p) => p.muscle_group === 'Shoulders' && p.exercise === 'Lateral Raise')!
    expect(sh.target_scheme).toBe(`${sh.sets} x 12-15`)
  })

  it('a different variant leads with a different exercise', () => {
    const v0 = composeFlexSession({ plans: PLANS, phase: '1-2', needs: [need('Chest', 5, 2)], focus: 'upper', length: 'full' })
    const v1 = composeFlexSession({ plans: PLANS, phase: '1-2', needs: [need('Chest', 5, 2)], focus: 'upper', length: 'full', variant: 1 })
    expect(v0.picks[0].exercise).not.toBe(v1.picks[0].exercise)
  })
})

describe('isFlex', () => {
  it('marks only high day numbers', () => {
    expect(isFlex({ day_number: FLEX_DAY_BASE })).toBe(true)
    expect(isFlex({ day_number: 6 })).toBe(false)
  })
})
