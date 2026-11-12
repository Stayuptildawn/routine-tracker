import { supabase } from './supabase'
import { t } from '../i18n'
import { starterPlanRows } from './starterPlan'

// The bundled starter plan (see starterPlan.ts), offered (never imposed) to
// accounts with no workout_plans. Fully editable after seeding.

export async function seedWorkoutTemplate(): Promise<void> {
  const rows = starterPlanRows(t.cues)
  for (let i = 0; i < rows.length; i += 50) {
    const { error } = await supabase.from('workout_plans').insert(rows.slice(i, i + 50))
    if (error) throw error
  }
}
