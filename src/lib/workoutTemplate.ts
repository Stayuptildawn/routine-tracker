import { supabase } from './supabase'

// The bundled starter plan, offered (never imposed) to accounts with no
// workout_plans: a joint-friendly 6-week PPL block plus an Upper/Lower
// follow-up. Machines, dumbbells and cables only; every exercise carries an
// injury-safe execution cue. Fully editable after seeding.

interface TplRow {
  split: string
  ex: string
  type: string
  cue: string
  muscle: string | null
  s12: string
  s34: string
  s56: string
  cardio?: string
}

const ZONE2 = 'Zone 2 Run (5km) Post-Workout'

const BLOCK1: TplRow[] = [
  { split: 'Push A', ex: 'Flat DB Bench Press', type: 'Compound', cue: 'Keep head flat and neutral on bench; do not strain neck to look at weights.', muscle: 'Chest', s12: '4 x 8-10', s34: '5 x 5', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Seated DB OHP', type: 'Compound', cue: 'Back fully supported, neutral neck alignment; avoid hyperextending cervical spine.', muscle: 'Shoulders', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Weighted Dip', type: 'Compound', cue: 'Keep torso slightly forward, neck aligned; do not look up or jerk at the bottom.', muscle: 'Chest', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15' },
  { split: 'Push A', ex: 'Cable Tricep Pushdown', type: 'Isolation', cue: 'Keep shoulders back, neck loose and relaxed; focus pure contraction on triceps.', muscle: 'Triceps', s12: '3 x 12-15', s34: '3 x 10', s56: '4 x 15-20' },
  { split: 'Pull A', ex: 'Weighted Lat Pulldown', type: 'Compound', cue: 'Pull to upper chest; do not crane neck forward or lean back aggressively.', muscle: 'Back', s12: '4 x 8-10', s34: '5 x 5', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull A', ex: 'Chest-Supported DB Row', type: 'Compound', cue: 'Incline bench supports chest completely, taking stress entirely off neck/lower back.', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 6', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull A', ex: 'Face Pull', type: 'Isolation', cue: 'Pull rope towards nose/forehead, focus on rear delts; keep neck stable and neutral.', muscle: 'Shoulders', s12: '3 x 12-15', s34: '3 x 12', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Pull A', ex: 'DB Hammer Curl', type: 'Isolation', cue: 'Keep head upright, neck relaxed; standard standing or seated control.', muscle: 'Biceps', s12: '3 x 12-15', s34: '3 x 8', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Legs A', ex: 'Leg Press', type: 'Compound', cue: 'Keep head rested back on pad; avoids any neck tension or spine axial loading.', muscle: 'Quads', s12: '4 x 8-10', s34: '5 x 6-10', s56: '3 x 12-15' },
  { split: 'Legs A', ex: 'Hack Squat Machine', type: 'Compound', cue: 'Shoulder pads support load; ensure upper back/neck is neutral against pad.', muscle: 'Quads', s12: '4 x 8-10', s34: '4 x 10', s56: '3 x 12-15' },
  { split: 'Legs A', ex: 'Leg Extension', type: 'Isolation', cue: 'Zero neck or back engagement; focus completely on squeezing quads at top.', muscle: 'Quads', s12: '3 x 12-15', s34: '4 x 12-15', s56: '4 x 15-20' },
  { split: 'Legs A', ex: 'Seated Calf Raise', type: 'Isolation', cue: 'Seated loading eliminates spine axial loading completely; keep upper body relaxed.', muscle: 'Calves', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Incline DB Bench Press', type: 'Compound', cue: 'Ensure incline angle is comfortable; keep head flat on bench throughout.', muscle: 'Chest', s12: '4 x 8-10', s34: '4 x 10-12', s56: '3 x 12-15' },
  { split: 'Push B', ex: 'Cable Lateral Raise', type: 'Isolation', cue: 'Cables provide constant tension; do not shrug shoulders up into neck.', muscle: 'Shoulders', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Pec Deck Fly', type: 'Isolation', cue: 'Seated chest fly eliminates stabilization stress on the upper back and neck.', muscle: 'Chest', s12: '3 x 12-15', s34: '4 x 12', s56: '4 x 15-20' },
  { split: 'Push B', ex: 'Overhead Cable Extension', type: 'Isolation', cue: 'Use rope; keep arms close to ears but do not force neck forward.', muscle: 'Triceps', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20' },
  { split: 'Pull B', ex: 'Close-Grip Pulldown', type: 'Compound', cue: 'Focus on drawing elbows down to hips; keep cervical spine in continuous alignment.', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 12', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Seated Cable Row', type: 'Compound', cue: 'Use a close or wide attachment; pull to lower belly, do not thrust head forward.', muscle: 'Back', s12: '4 x 8-10', s34: '4 x 12', s56: '3 x 12-15', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Reverse Fly Machine', type: 'Isolation', cue: 'Chest supported on pad; targets rear delts/upper back safely without neck strain.', muscle: 'Shoulders', s12: '3 x 12-15', s34: '4 x 15', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Pull B', ex: 'Incline DB Curl', type: 'Isolation', cue: 'Seated on incline bench; allows arms to hang back, isolating biceps safely.', muscle: 'Biceps', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20', cardio: ZONE2 },
  { split: 'Legs B', ex: 'Hip Thrust', type: 'Compound', cue: 'Load is placed on hips; chin tucked slightly to protect spine, no axial neck load.', muscle: 'Glutes', s12: '4 x 8-10', s34: '5 x 6-10', s56: '3 x 12-15' },
  { split: 'Legs B', ex: 'Bulgarian Split Squat', type: 'Compound', cue: 'Hold DBs at sides; eliminates spine compression entirely compared to barbell.', muscle: 'Quads', s12: '4 x 8-10', s34: '4 x 10', s56: '3 x 12-15' },
  { split: 'Legs B', ex: 'Lying Leg Curl', type: 'Isolation', cue: 'Lying flat keeps spine safe; do not lift head up during the eccentric phase.', muscle: 'Hamstrings', s12: '3 x 12-15', s34: '4 x 12', s56: '4 x 15-20' },
  { split: 'Legs B', ex: 'Cable Pull-Through', type: 'Isolation', cue: 'Glute/hamstring focus using cable from behind; keep spine neutral, do not look up.', muscle: 'Glutes', s12: '3 x 12-15', s34: '3 x 15', s56: '4 x 15-20' },
  { split: 'Rest Day', ex: 'Rest & Strategic Recovery', type: 'N/A', cue: 'Focus on general mobility, gentle stretching, and nutritional compliance.', muscle: null, s12: 'Rest', s34: 'Rest', s56: 'Rest', cardio: 'Full Recovery' },
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
      safety_note: r.cue,
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
        safety_note: src.cue,
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
