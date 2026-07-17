import { supabase } from './supabase'
import { localDate, isoWeekday } from './types'
import type { WorkoutPlan } from './types'
import { t } from '../i18n'

/** "4 x 8-10" -> 4 sets. Anything unparseable (e.g. "Rest") -> 0. */
export function setCount(scheme: string | undefined | null): number {
  const n = parseInt(scheme ?? '', 10)
  return Number.isFinite(n) && n > 0 && n <= 10 ? n : 0
}

export function phaseKey(week: number): string {
  return week <= 2 ? '1-2' : week <= 4 ? '3-4' : '5-6'
}


/** What the recovery check-ins suggest per muscle: +1 set, -1 set, or nothing.
 *  Needs at least two answers for a muscle in the last 60 days to say anything. */
export async function recoveryAdjustments(): Promise<Map<string, number>> {
  const since = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data } = await supabase
    .from('recovery_checkins')
    .select('muscle_group, amount')
    .gte('created_at', since)
    .not('amount', 'is', null)
  const perMuscle = new Map<string, { tooMuch: number; room: number; answers: number }>()
  for (const row of data ?? []) {
    const m = perMuscle.get(row.muscle_group) ?? { tooMuch: 0, room: 0, answers: 0 }
    m.answers++
    if (row.amount === 'over_the_line') m.tooMuch += 1
    else if (row.amount === 'stretch') m.tooMuch += 0.5
    else if (row.amount === 'could_take_more') m.room += 1
    perMuscle.set(row.muscle_group, m)
  }
  const adjustments = new Map<string, number>()
  for (const [muscle, m] of perMuscle) {
    if (m.answers < 2) continue
    const net = m.room - m.tooMuch
    if (net >= 1.5) adjustments.set(muscle, 1)
    else if (net <= -1) adjustments.set(muscle, -1)
  }
  return adjustments
}

/** Instantiate a block: every session and set, generated from the plan.
 *  adjustments (from recoveryAdjustments) tune set counts ±1 per muscle,
 *  never below 2 sets - shown to the user before this runs, never silent. */
export async function startBlock(
  allPlans: WorkoutPlan[],
  blockNumber: number,
  adjustments: Map<string, number> = new Map(),
): Promise<string> {
  const plans = allPlans.filter((p) => p.block === blockNumber)
  if (plans.length === 0) throw new Error(`no plan rows for block ${blockNumber}`)
  const monday = new Date()
  monday.setDate(monday.getDate() - (isoWeekday() - 1))
  const totalWeeks = 6

  const { data: block, error } = await supabase
    .from('training_blocks')
    .insert({
      name: t.blocks.names[blockNumber] ?? t.blocks.fallback(blockNumber),
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
      const base = setCount(scheme)
      const delta = p.muscle_group ? adjustments.get(p.muscle_group) ?? 0 : 0
      const count = base > 0 ? Math.max(2, base + delta) : 0
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
