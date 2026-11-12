// The plan builder turns "days a week + session length" into a standing plan.
// These pin what a user can rely on whatever they pick: the right number of
// days, sessions that fit their slot, sane doses, and nobody left out.
import { describe, it, expect } from 'vitest'
import { buildPlan, planRows, WEEK_LAYOUTS } from '../src/lib/planBuilder'
import { BUDGET } from '../src/lib/flexSession'
import type { FlexLength } from '../src/lib/flexSession'

const LENGTHS: FlexLength[] = ['short', 'full']
const MUSCLES = ['Chest', 'Back', 'Quads', 'Glutes', 'Shoulders', 'Hamstrings', 'Biceps', 'Triceps', 'Calves']

/** hard sets per muscle within one day */
const perMuscle = (day: { exercises: { muscle_group: string; sets: number }[] }) => {
  const m = new Map<string, number>()
  for (const x of day.exercises) m.set(x.muscle_group, (m.get(x.muscle_group) ?? 0) + x.sets)
  return m
}

/** every day of every plan the builder can make, with a label for failures */
function everyDay() {
  const out: { label: string; length: FlexLength; day: ReturnType<typeof buildPlan>['days'][number] }[] = []
  for (const length of LENGTHS) {
    for (let days = 1; days <= 6; days++) {
      for (const day of buildPlan({ days, length }).days) {
        out.push({ label: `${days} days, ${length}, ${day.focus}${day.letter ?? ''}`, length, day })
      }
    }
  }
  return out
}

describe('buildPlan', () => {
  it('gives one session per gym day, laid out by the week pattern', () => {
    for (let days = 1; days <= 6; days++) {
      const plan = buildPlan({ days, length: 'full' })
      expect(plan.days.map((d) => d.focus)).toEqual(WEEK_LAYOUTS[days])
    }
  })

  it('never fills a session past its slot, and never leaves it thin', () => {
    for (const { label, length, day } of everyDay()) {
      expect(day.sets, label).toBeLessThanOrEqual(BUDGET[length])
      expect(day.sets, label).toBeGreaterThanOrEqual(12)
    }
  })

  it('doses every muscle it trains between 3 and 6 sets a session', () => {
    for (const { label, day } of everyDay()) {
      for (const [muscle, sets] of perMuscle(day)) {
        expect(sets, `${label}: ${muscle}`).toBeGreaterThanOrEqual(3)
        expect(sets, `${label}: ${muscle}`).toBeLessThanOrEqual(6)
      }
      for (const x of day.exercises) expect(x.sets, `${label}: ${x.exercise}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('never lists the same exercise twice in a session', () => {
    for (const { label, day } of everyDay()) {
      const names = day.exercises.map((x) => x.exercise)
      expect(new Set(names).size, label).toBe(names.length)
    }
  })

  it('puts compounds ahead of isolations', () => {
    for (const { label, day } of everyDay()) {
      const types = day.exercises.map((x) => x.type)
      const firstIsolation = types.indexOf('Isolation')
      if (firstIsolation !== -1) expect(types.lastIndexOf('Compound'), label).toBeLessThan(firstIsolation)
    }
  })

  it('trains every muscle at least once a week from three days up', () => {
    for (const length of LENGTHS) {
      for (let days = 3; days <= 6; days++) {
        const trained = new Set(buildPlan({ days, length }).days.flatMap((d) => d.exercises.map((x) => x.muscle_group)))
        for (const m of MUSCLES) expect(trained.has(m), `${days} days, ${length}: ${m}`).toBe(true)
      }
    }
  })

  it('brings back on the second day what the first had no room for', () => {
    // two short full-body days hold four muscles each: the second starts
    // with the ones the first left out
    const [a, b] = buildPlan({ days: 2, length: 'short' }).days
    const first = new Set(a.exercises.map((x) => x.muscle_group))
    const second = new Set(b.exercises.map((x) => x.muscle_group))
    expect(first.has('Chest') && first.has('Back') && first.has('Quads')).toBe(true)
    expect([...second].some((m) => !first.has(m))).toBe(true)
  })

  it('leads a repeated day with different lifts and letters it', () => {
    const plan = buildPlan({ days: 4, length: 'full' })
    expect(plan.days.map((d) => d.letter)).toEqual(['A', 'A', 'B', 'B'])
    const [upperA, , upperB] = plan.days
    expect(upperA.exercises[0].exercise).not.toBe(upperB.exercises[0].exercise)
    expect(buildPlan({ days: 3, length: 'full' }).days.every((d) => d.letter === null)).toBe(true)
  })

  it('keeps rear-delt work on pull days and pressing on push days', () => {
    const plan = buildPlan({ days: 6, length: 'full' })
    const names = (focus: string) => plan.days.filter((d) => d.focus === focus).flatMap((d) => d.exercises.map((x) => x.exercise))
    expect(names('pull')).not.toContain('Seated DB OHP')
    expect(names('push')).not.toContain('Face Pull')
    expect(names('pull').some((n) => n === 'Face Pull' || n === 'Reverse Fly Machine')).toBe(true)
  })

  it('is deterministic, and another mix changes the lifts but not the shape', () => {
    const a = buildPlan({ days: 4, length: 'full' })
    expect(buildPlan({ days: 4, length: 'full' })).toEqual(a)
    const b = buildPlan({ days: 4, length: 'full', variant: 1 })
    expect(b.days.map((d) => d.sets)).toEqual(a.days.map((d) => d.sets))
    expect(b.days[0].exercises.map((x) => x.exercise)).not.toEqual(a.days[0].exercises.map((x) => x.exercise))
  })

  it('clamps a day count outside 1-6', () => {
    expect(buildPlan({ days: 0, length: 'full' }).days).toHaveLength(1)
    expect(buildPlan({ days: 9, length: 'full' }).days).toHaveLength(6)
  })
})

describe('planRows', () => {
  it('writes one row per exercise with a scheme for every phase', () => {
    const plan = buildPlan({ days: 3, length: 'full' })
    const rows = planRows(plan, 2, ['Upper', 'Lower', 'Full body'], { 'Leg Press': 'cue' })
    expect(rows).toHaveLength(plan.days.reduce((a, d) => a + d.exercises.length, 0))
    expect(rows.every((r) => r.block === 2)).toBe(true)
    expect(rows.map((r) => r.sort_order)).toEqual(rows.map((_, i) => i + 1))
    expect(new Set(rows.map((r) => r.split_day))).toEqual(new Set(['Upper', 'Lower', 'Full body']))
    for (const r of rows) {
      expect(Object.keys(r.schemes).sort()).toEqual(['1-2', '3-4', '5-6'])
      for (const s of Object.values(r.schemes)) expect(s).toMatch(/^\d x \d+-\d+$/)
    }
    expect(rows.find((r) => r.exercise === 'Leg Press')?.safety_note).toBe('cue')
  })
})
