// Guards the generated exercise database: every entry must carry one of the
// app's muscle-group values (PlanEditor's dropdown), and the freeform lookup
// must match the way people actually type exercise names.
import { describe, expect, it } from 'vitest'
import { EXERCISE_DB, muscleForExercise } from '../supabase/functions/_shared/exerciseDb'

const APP_MUSCLES = ['Chest', 'Shoulders', 'Triceps', 'Back', 'Biceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Other']

describe('exercise database', () => {
  it('has a useful size and no duplicate names', () => {
    expect(EXERCISE_DB.length).toBeGreaterThan(1000)
    const names = EXERCISE_DB.map(([n]) => n.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })
  it('only uses the app muscle vocabulary', () => {
    for (const [, muscle] of EXERCISE_DB) expect(APP_MUSCLES).toContain(muscle)
  })
})

describe('muscleForExercise', () => {
  it('matches exact and fuzzy names', () => {
    expect(muscleForExercise('barbell bench press')).toBe('Chest')
    expect(muscleForExercise('Barbell Bench Press')).toBe('Chest')
    expect(muscleForExercise('lat pulldown')).toBe('Back')
    expect(muscleForExercise('leg press')).toBe('Quads')
    expect(muscleForExercise('hammer curl')).toBe('Biceps')
    expect(muscleForExercise('seated calf raise')).toBe('Calves')
  })
  it('survives word order and gym shorthand', () => {
    expect(muscleForExercise('incline dumbbell curl')).toBe('Biceps') // dataset says "dumbbell incline curl"
    expect(muscleForExercise('Incline DB Curl')).toBe('Biceps') // the app template's own spelling
    expect(muscleForExercise('press bench barbell')).toBe('Chest')
  })
  it('never guesses on junk or too-short input', () => {
    expect(muscleForExercise('xyzzyplugh')).toBeNull()
    expect(muscleForExercise('abc')).toBeNull()
    expect(muscleForExercise('')).toBeNull()
  })
})
