import { supabase } from './supabase'
import { t } from '../i18n'

// The bundled starter plan, offered (never imposed) to accounts with no
// workout_plans: a joint-friendly 6-week PPL block plus an Upper/Lower
// follow-up. Machines, dumbbells and cables only; every exercise carries an
// injury-safe execution cue. Fully editable after seeding.

interface TplRow {
  split: string
  ex: string
  type: string
  muscle: string | null
  s12: string
  s34: string
  s56: string
  cardio?: string
}

const ZONE2 = 'Zone 2 Run (5km) Post-Workout'

const BLOCK1: TplRow[] = [
  { split: 'Push A', ex: 'Flat DB Bench Press', type: 'Compound', muscle: 'Chest', s12: '4 x 8-10', s34: '5 x 5', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Seated DB OHP', type: 'Compound', muscle: 'Shoulders', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Weighted Dip', type: 'Compound', muscle: 'Chest', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Cable Tricep Pushdown', type: 'Isolation', muscle: 'Triceps', s12: '3 x 12-15', s34: '3 x 10', s56: '4 x 15-20' },
  { split: 'Pull A', ex: 'Weighted Lat Pulldown', type: 'Compound', muscle: 'Back', s12: '4 x 8-10', s34: '5 x 5', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull A', ex: 'Chest-Supported DB Row', type: 'Compound', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull A', ex: 'Face Pull', type: 'Isolation', muscle: 'Shoulders', s12: '3 x 12-15', s34: '3 x 12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Pull A', ex: 'DB Hammer Curl', type: 'Isolation', muscle: 'Biceps', s12: '3 x 12-15', s34: '3 x 8', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Legs A', ex: 'Leg Press', type: 'Compound', muscle: 'Quads', s12: '4 x 8-10', s34: '5 x 6-10', s56: '3 x 12-15' },
  { split: 'Legs A', ex: 'Hack Squat Machine', type: 'Compound', muscle: 'Quads', s12: '4 x 8-10', s34: '4 x 10', s56: '3 x 12-15' },
  { split: 'Legs A', ex: 'Leg Extension', type: 'Isolation', muscle: 'Quads', s12: '3 x 12-15', s34: '4 x 12-15', s56: '4 x 15-20' },
  { split: 'Legs A', ex: 'Seated Calf Raise', type: 'Isolation', muscle: 'Calves', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Incline DB Bench Press', type: 'Compound', muscle: 'Chest', s12: '4 x 8-10', s34: '4 x 10-12', s56: '3 x 12-15' },
  { split: 'Push B', ex: 'Cable Lateral Raise', type: 'Isolation', muscle: 'Shoulders', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Pec Deck Fly', type: 'Isolation', muscle: 'Chest', s12: '3 x 12-15', s34: '4 x 12', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Overhead Cable Extension', type: 'Isolation', muscle: 'Triceps', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20' },
  { split: 'Pull B', ex: 'Close-Grip Pulldown', type: 'Compound', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 12', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Seated Cable Row', type: 'Compound', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 12', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Reverse Fly Machine', type: 'Isolation', muscle: 'Shoulders', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Incline DB Curl', type: 'Isolation', muscle: 'Biceps', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Legs B', ex: 'Hip Thrust', type: 'Compound', muscle: 'Glutes', s12: '4 x 8-10', s34: '5 x 6-10', s56: '3 x 12-15' },
  { split: 'Legs B', ex: 'Bulgarian Split Squat', type: 'Compound', muscle: 'Quads', s12: '4 x 8-10', s34: '4 x 10', s56: '3 x 12-15' },
  { split: 'Legs B', ex: 'Lying Leg Curl', type: 'Isolation', muscle: 'Hamstrings', s12: '3 x 12-15', s34: '4 x 12', s56: '4 x 15-20' },
  { split: 'Legs B', ex: 'Cable Pull-Through', type: 'Isolation', muscle: 'Glutes', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20' },
  { split: 'Rest Day', ex: 'Rest & Strategic Recovery', type: 'N/A', muscle: null, s12: 'Rest', s34: 'Rest', s56: 'Rest', cardio: 'Full Recovery' },
]

// Block 2 reuses Block 1 exercises (cues/muscles inherited) with its own wave
const BLOCK2: { split: string; ex: string; s12: string; s34: string; s56: string; cardio?: string }[] = [
  { split: 'Upper A', ex: 'Flat DB Bench Press', s12: '4 x 6-8', s34: '5 x 4-6', s56: '3 x 8-10' },
  { split: 'Upper A', ex: 'Chest-Supported DB Row', s12: '4 x 6-8', s34: '5 x 4-6', s56: '3 x 8-10' },
  { split: 'Upper A', ex: 'Seated DB OHP', s12: '4 x 6-8', s34: '4 x 4-6', s56: '3 x 8-10' },
  { split: 'Upper A', ex: 'Weighted Lat Pulldown', s12: '4 x 6-8', s34: '4 x 4-6', s56: '3 x 8-10' },
  { split: 'Upper A', ex: 'Cable Tricep Pushdown', s12: '3 x 10-12', s34: '3 x 8-10', s56: '3 x 12-15' },
  { split: 'Upper A', ex: 'DB Hammer Curl', s12: '3 x 10-12', s34: '3 x 8-10', s56: '3 x 12-15' },
  { split: 'Lower A', ex: 'Leg Press', s12: '4 x 8-10', s34: '5 x 6-8', s56: '3 x 10-12' },
  { split: 'Lower A', ex: 'Lying Leg Curl', s12: '4 x 8-10', s34: '4 x 6-8', s56: '3 x 10-12' },
  { split: 'Lower A', ex: 'Hip Thrust', s12: '4 x 8-10', s34: '4 x 6-8', s56: '3 x 10-12' },
  { split: 'Lower A', ex: 'Leg Extension', s12: '3 x 12-15', s34: '3 x 10-12', s56: '3 x 15-20' },
  { split: 'Lower A', ex: 'Seated Calf Raise', s12: '4 x 10-12', s34: '4 x 8-10', s56: '4 x 12-15' },
  { split: 'Upper B', ex: 'Incline DB Bench Press', s12: '4 x 10-12', s34: '4 x 8-10', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Seated Cable Row', s12: '4 x 10-12', s34: '4 x 8-10', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Cable Lateral Raise', s12: '4 x 12-15', s34: '4 x 10-12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Pec Deck Fly', s12: '3 x 12-15', s34: '3 x 10-12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Close-Grip Pulldown', s12: '3 x 10-12', s34: '3 x 8-10', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Overhead Cable Extension', s12: '3 x 12-15', s34: '3 x 10-12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Upper B', ex: 'Incline DB Curl', s12: '3 x 12-15', s34: '3 x 10-12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Lower B', ex: 'Cable Pull-Through', s12: '4 x 10-12', s34: '4 x 8-10', s56: '3 x 12-15' },
  { split: 'Lower B', ex: 'Lying Leg Curl', s12: '4 x 10-12', s34: '4 x 8-10', s56: '4 x 12-15' },
  { split: 'Lower B', ex: 'Bulgarian Split Squat', s12: '3 x 8-10', s34: '4 x 6-8', s56: '3 x 10-12' },
  { split: 'Lower B', ex: 'Hack Squat Machine', s12: '3 x 10-12', s34: '3 x 8-10', s56: '3 x 12-15' },
  { split: 'Lower B', ex: 'Seated Calf Raise', s12: '4 x 10-12', s34: '4 x 8-10', s56: '4 x 12-15' },
  { split: 'Upper C', ex: 'Pec Deck Fly', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Upper C', ex: 'Face Pull', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Upper C', ex: 'Cable Lateral Raise', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Upper C', ex: 'Seated Cable Row', s12: '3 x 15-20', s34: '3 x 12-15', s56: '3 x 15-20' },
  { split: 'Upper C', ex: 'Cable Tricep Pushdown', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Upper C', ex: 'Incline DB Curl', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Lower C', ex: 'Bulgarian Split Squat', s12: '3 x 12-15', s34: '3 x 10-12', s56: '3 x 15-20' },
  { split: 'Lower C', ex: 'Leg Extension', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Lower C', ex: 'Lying Leg Curl', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Lower C', ex: 'Cable Pull-Through', s12: '3 x 15-20', s34: '3 x 12-15', s56: '4 x 15-20' },
  { split: 'Lower C', ex: 'Seated Calf Raise', s12: '4 x 15-20', s34: '4 x 12-15', s56: '4 x 15-20' },
]

export async function seedWorkoutTemplate(): Promise<void> {
  const byEx = new Map(BLOCK1.map((r) => [r.ex, r]))
  const rows = [
    ...BLOCK1.map((r, i) => ({
      block: 1,
      split_day: r.split,
      sort_order: i + 1,
      exercise: r.ex,
      type: r.type,
      safety_note: t.cues[r.ex] ?? null,
      muscle_group: r.muscle,
      schemes: { '1-2': r.s12, '3-4': r.s34, '5-6': r.s56 },
      cardio: r.cardio ?? null,
    })),
    ...BLOCK2.map((r, i) => {
      const src = byEx.get(r.ex)!
      return {
        block: 2,
        split_day: r.split,
        sort_order: i + 1,
        exercise: r.ex,
        type: src.type,
        safety_note: t.cues[r.ex] ?? null,
        muscle_group: src.muscle,
        schemes: { '1-2': r.s12, '3-4': r.s34, '5-6': r.s56 },
        cardio: r.cardio ?? null,
      }
    }),
  ]
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('workout_plans').insert(rows.slice(i, i + 50))
    if (error) throw error
  }
}
