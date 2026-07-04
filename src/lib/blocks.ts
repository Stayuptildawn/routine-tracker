import { supabase } from './supabase'
import { localDate, isoWeekday } from './types'
import type { WorkoutPlan } from './types'

/** "4 x 8-10" -> 4 sets. Anything unparseable (e.g. "Rest") -> 0. */
export function setCount(scheme: string | undefined | null): number {
  const n = parseInt(scheme ?? '', 10)
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 0
}

export function phaseKey(week: number): string {
  return week <= 2 ? '1-2' : week <= 4 ? '3-4' : '5-6'
}

const BLOCK_NAMES: Record<number, string> = { 1: 'Block 1 — PPL', 2: 'Block 2 — Upper/Lower' }

/** Instantiate a block: every session and set, generated from the plan. */
export async function startBlock(allPlans: WorkoutPlan[], blockNumber: number): Promise<string> {
  const plans = allPlans.filter((p) => p.block === blockNumber)
  if (plans.length === 0) throw new Error(`no plan rows for block ${blockNumber}`)
  const monday = new Date()
  monday.setDate(monday.getDate() - (isoWeekday() - 1))
  const totalWeeks = 6

  const { data: block, error } = await supabase
    .from('training_blocks')
    .insert({
      name: BLOCK_NAMES[blockNumber] ?? `Block ${blockNumber}`,
      block: blockNumber,
      start_date: localDate(monday),
      total_weeks: totalWeeks,
    })
    .select('id')
    .single()
  if (error) throw error

  // sessions: one per split per week, skipping splits with no loggable sets
  const splits = [...new Set(plans.map((p) => p.split_day))].filter((s) =>
    plans.some((p) => p.split_day === s && setCount(p.schemes?.['1-2']) > 0),
  )
  const sessions: Record<string, unknown>[] = []
  for (let week = 1; week <= totalWeeks; week++) {
    splits.forEach((split, i) => {
      sessions.push({
        block_id: block.id,
        week_number: week,
        day_number: i + 1,
        split_day: split,
        cardio: plans.find((p) => p.split_day === split && p.cardio)?.cardio ?? null,
      })
    })
  }
  const { data: sessionRows, error: sessErr } = await supabase
    .from('planned_sessions')
    .insert(sessions)
    .select('id, week_number, split_day')
  if (sessErr) throw sessErr

  const sets: Record<string, unknown>[] = []
  for (const s of sessionRows ?? []) {
    const phase = phaseKey(s.week_number)
    let order = 0
    for (const p of plans.filter((p) => p.split_day === s.split_day)) {
      const scheme = p.schemes?.[phase] ?? null
      const count = setCount(scheme)
      for (let n = 1; n <= count; n++) {
        sets.push({
          session_id: s.id,
          sort_order: ++order,
          exercise: p.exercise,
          muscle_group: p.muscle_group ?? null,
          set_number: n,
          target_scheme: scheme,
        })
      }
    }
  }
  // chunked insert; ~700 rows total
  for (let i = 0; i < sets.length; i += 200) {
    const { error: setErr } = await supabase.from('planned_sets').insert(sets.slice(i, i + 200))
    if (setErr) throw setErr
  }
  return block.id
}
