import { supabase } from './supabase'
import { buildContentMaps } from './contentMaps'

// One-time, on-demand translation of seed-derived DATA (not UI strings) into
// the given language: routine names, task labels, the starter plan's safety
// cues, training-block names - and reminder categories, which store routine
// names as text and would otherwise fold into "Other" after a rename.
// Deterministic lookup only (see contentMaps.ts): anything the user wrote or
// renamed matches nothing and is left exactly as it is. No AI involved.

export async function translateSeededContent(targetId: string): Promise<number> {
  const maps = buildContentMaps(targetId)
  let changed = 0

  const apply = async (
    table: string,
    column: string,
    rows: { id: string; [k: string]: unknown }[] | null,
    map: Map<string, string>,
  ) => {
    for (const row of rows ?? []) {
      const current = row[column] as string | null
      const next = current ? map.get(current) : undefined
      if (!next || next === current) continue
      const { error } = await supabase.from(table).update({ [column]: next }).eq('id', row.id)
      if (!error) changed++
    }
  }

  const [{ data: routines }, { data: tasks }, { data: plans }, { data: blocks }, { data: reminders }] =
    await Promise.all([
      supabase.from('routines').select('id, name'),
      supabase.from('tasks').select('id, label'),
      supabase.from('workout_plans').select('id, safety_note'),
      supabase.from('training_blocks').select('id, name'),
      supabase.from('reminders').select('id, final_category'),
    ])

  await apply('routines', 'name', routines, maps.routineNames)
  await apply('tasks', 'label', tasks, maps.taskLabels)
  await apply('workout_plans', 'safety_note', plans, maps.cueTexts)
  await apply('training_blocks', 'name', blocks, maps.blockNames)
  // reminder categories are routine names stored as text ("Other" is a
  // sentinel that stays untranslated by design)
  await apply('reminders', 'final_category', reminders, maps.routineNames)

  return changed
}
