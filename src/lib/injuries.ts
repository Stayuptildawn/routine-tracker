// Injury reports, database side. Planning is pure (./injuryPlan.ts); this
// file fetches the upcoming sessions, applies a plan, and on "healed"
// restores exactly the rows the injury changed. Everything goes through the
// signed-in client, so RLS keeps it to the user's own rows.

import { supabase } from './supabase'
import { localDate } from './types'
import type { TrainingBlock, WorkoutPlan } from './types'
import { t } from '../i18n'
import { handledIds, planInjury } from './injuryPlan'
import type { BodyPart, InjuryChange, PreviewLine, Severity, UpcomingSet, UpcomingSession } from './injuryPlan'

export interface Injury {
  id: string
  body_part: BodyPart
  severity: Severity
  note: string | null
  started_on: string
  healed_on: string | null
  changes: InjuryChange[]
  created_at: string
}

const notesFor = (part: BodyPart) => ({
  cue: t.injuries.cueNote(t.injuries.parts[part]),
  lighter: t.injuries.lighterNote(t.injuries.parts[part]),
  swapped: (from: string) => t.injuries.swappedNote(t.injuries.parts[part], from),
  lowImpactCardio: t.injuries.lowImpactCardio,
})

export async function activeInjuries(): Promise<Injury[]> {
  const { data } = await supabase.from('injuries').select('*').is('healed_on', null).order('created_at')
  return (data as Injury[]) ?? []
}

/** Unlogged sets + sessions of the running block that haven't been finished. */
async function upcoming(blockId: string): Promise<{ sets: UpcomingSet[]; sessions: UpcomingSession[] }> {
  const { data: sess } = await supabase
    .from('planned_sessions')
    .select('id, cardio, completed_at')
    .eq('block_id', blockId)
    .is('completed_at', null)
  const sessions = ((sess ?? []) as (UpcomingSession & { completed_at: string | null })[]).map(({ id, cardio }) => ({ id, cardio }))
  const sets: UpcomingSet[] = []
  for (const ids of chunks(sessions.map((s) => s.id))) {
    const { data } = await supabase.from('planned_sets').select('*').in('session_id', ids).is('logged_at', null)
    sets.push(...((data as UpcomingSet[]) ?? []))
  }
  return { sets, sessions }
}

export async function previewInjury(
  part: BodyPart,
  severity: Severity,
  block: TrainingBlock | null,
  plans: WorkoutPlan[],
  others: Injury[],
): Promise<{ changes: InjuryChange[]; preview: PreviewLine[] }> {
  if (!block) return { changes: [], preview: [] }
  const { sets, sessions } = await upcoming(block.id)
  return planInjury({
    part,
    severity,
    sets,
    sessions,
    plans: plans.filter((p) => p.block === block.block),
    others: others.map((o) => o.body_part),
    notes: notesFor(part),
  })
}

// ids go into the request URL - keep each call well under URL limits
const CHUNK = 100
const chunks = <T,>(list: T[]): T[][] =>
  Array.from({ length: Math.ceil(list.length / CHUNK) }, (_, i) => list.slice(i * CHUNK, (i + 1) * CHUNK))

/** Rows that get identical values share one update - a severe injury can
 *  touch hundreds of sets, and one request each would take half a minute. */
function groupByValue<T>(items: { id: string; value: T }[]): { value: T; ids: string[] }[] {
  const groups = new Map<string, { value: T; ids: string[] }>()
  for (const { id, value } of items) {
    const key = JSON.stringify(value)
    const g = groups.get(key) ?? { value, ids: [] }
    g.ids.push(id)
    groups.set(key, g)
  }
  return [...groups.values()]
}

async function applyChanges(changes: InjuryChange[]) {
  const drops = changes.filter((c) => c.kind === 'drop').map((c) => (c as { row: UpcomingSet }).row.id)
  for (const ids of chunks(drops)) {
    const { error } = await supabase.from('planned_sets').delete().in('id', ids)
    if (error) throw error
  }
  const sets = changes.flatMap((c) => (c.kind === 'set' ? [{ id: c.id, value: c.after }] : []))
  for (const { value, ids: all } of groupByValue(sets)) {
    for (const ids of chunks(all)) {
      const { error } = await supabase.from('planned_sets').update(value).in('id', ids).is('logged_at', null)
      if (error) throw error
    }
  }
  const cardio = changes.flatMap((c) => (c.kind === 'cardio' ? [{ id: c.session_id, value: c.after }] : []))
  for (const { value, ids: all } of groupByValue(cardio)) {
    for (const ids of chunks(all)) {
      const { error } = await supabase.from('planned_sessions').update({ cardio: value }).in('id', ids)
      if (error) throw error
    }
  }
}

async function selectIn<R>(table: string, cols: string, ids: string[], openOnly = false): Promise<R[]> {
  const out: R[] = []
  for (const part of chunks([...new Set(ids)])) {
    let q = supabase.from(table).select(cols).in('id', part)
    if (openOnly) q = q.is('completed_at', null)
    const { data } = await q
    out.push(...((data ?? []) as R[]))
  }
  return out
}

/** Save the injury and apply its previewed changes. The row (with its
 *  change log) is written first, so a half-applied plan can still be undone. */
export async function reportInjury(part: BodyPart, severity: Severity, note: string, changes: InjuryChange[]): Promise<void> {
  const { data, error } = await supabase
    .from('injuries')
    .insert({ body_part: part, severity, note: note.trim() || null, started_on: localDate(), changes })
    .select('id')
    .single()
  if (error) throw error
  try {
    await applyChanges(changes)
  } catch (err) {
    // roll back what landed, then forget the report - it never took effect
    await healInjury({ id: data.id, changes })
    await supabase.from('injuries').delete().eq('id', data.id)
    throw err
  }
}

/** Mark healed and put back what this injury changed - but only rows still
 *  in the state it left them (a set logged since, or edited by hand, stays). */
export async function healInjury(passed: Pick<Injury, 'id' | 'changes'>): Promise<void> {
  // the stored log, not the caller's copy: a reconcile since the screen
  // loaded may have appended changes the caller never saw
  const { data: fresh } = await supabase.from('injuries').select('id, changes').eq('id', passed.id).maybeSingle()
  const injury = (fresh as Pick<Injury, 'id' | 'changes'> | null) ?? passed
  type SetNow = { id: string; exercise: string; target_scheme: string | null; injury_note: string | null; logged_at: string | null }
  type SessNow = { id: string; cardio: string | null; completed_at: string | null }
  const setChanges = injury.changes.flatMap((c) => (c.kind === 'set' ? [c] : []))
  const cardioChanges = injury.changes.flatMap((c) => (c.kind === 'cardio' ? [c] : []))
  const dropRows = injury.changes.flatMap((c) => (c.kind === 'drop' ? [c.row] : []))

  const byId = new Map((await selectIn<SetNow>('planned_sets', 'id, exercise, target_scheme, injury_note, logged_at', setChanges.map((c) => c.id))).map((r) => [r.id, r]))
  const sessById = new Map((await selectIn<SessNow>('planned_sessions', 'id, cardio, completed_at', cardioChanges.map((c) => c.session_id))).map((s) => [s.id, s]))
  // dropped sets come back only into sessions that are still open
  const open = new Set((await selectIn<{ id: string }>('planned_sessions', 'id', dropRows.map((r) => r.session_id), true)).map((s) => s.id))

  // only rows still exactly as this injury left them - logged since, or
  // edited by hand (or by a later injury), they stay as they are
  const restoreSets = setChanges.filter((c) => {
    const now = byId.get(c.id)
    return (
      now && !now.logged_at &&
      now.exercise === c.after.exercise &&
      (now.target_scheme ?? null) === c.after.target_scheme &&
      (now.injury_note ?? null) === c.after.injury_note
    )
  })
  for (const { value, ids: all } of groupByValue(restoreSets.map((c) => ({ id: c.id, value: c.before })))) {
    for (const ids of chunks(all)) await supabase.from('planned_sets').update(value).in('id', ids)
  }
  const restoreCardio = cardioChanges.filter((c) => {
    const s = sessById.get(c.session_id)
    return s && !s.completed_at && s.cardio === c.after
  })
  for (const { value, ids: all } of groupByValue(restoreCardio.map((c) => ({ id: c.session_id, value: c.before })))) {
    for (const ids of chunks(all)) await supabase.from('planned_sessions').update({ cardio: value }).in('id', ids)
  }
  // a set this injury changed and a later (still active) injury changed
  // again was skipped above. Hand the original values over to that injury's
  // log, so healing it later restores the plan and not this injury's version
  const skipped = new Map(setChanges.filter((c) => !restoreSets.includes(c)).map((c) => [c.id, c]))
  if (skipped.size > 0) {
    const { data: others } = await supabase.from('injuries').select('id, changes').is('healed_on', null).neq('id', injury.id)
    for (const other of (others ?? []) as Pick<Injury, 'id' | 'changes'>[]) {
      let touched = false
      const changes = other.changes.map((c) => {
        const id = c.kind === 'set' ? c.id : c.kind === 'drop' ? c.row.id : null
        const mine = id ? skipped.get(id) : undefined
        if (!mine) return c
        touched = true
        return c.kind === 'set' ? { ...c, before: mine.before } : c.kind === 'drop' ? { ...c, row: { ...c.row, ...mine.before } } : c
      })
      if (touched) await supabase.from('injuries').update({ changes }).eq('id', other.id)
    }
  }

  const restore = dropRows.filter((r) => open.has(r.session_id))
  for (const rows of chunks(restore)) {
    // upsert on id: a restore that already ran (double tap) can't duplicate
    await supabase.from('planned_sets').upsert(rows, { onConflict: 'id' })
  }
  await supabase.from('injuries').update({ healed_on: localDate() }).eq('id', injury.id)
}

/** Sessions created after an injury was reported (a new block, a flex day,
 *  plan edits pushed to the block) get the same treatment it was approved
 *  with. Re-running is a no-op: each injury skips rows it already handled.
 *  Returns whether anything changed. */
export async function reconcileInjuries(
  injuries: Injury[],
  block: TrainingBlock | null,
  plans: WorkoutPlan[],
): Promise<boolean> {
  if (!block || injuries.length === 0) return false
  let changed = false
  for (const injury of injuries) {
    const { sets, sessions } = await upcoming(block.id)
    const { changes } = planInjury({
      part: injury.body_part,
      severity: injury.severity,
      sets,
      sessions,
      plans: plans.filter((p) => p.block === block.block),
      others: injuries.filter((o) => o.id !== injury.id).map((o) => o.body_part),
      handled: handledIds(injury.changes),
      notes: notesFor(injury.body_part),
    })
    if (changes.length === 0) continue
    const all = [...injury.changes, ...changes]
    // only while it is still active - healed meanwhile, its changes must not land
    const { data: still, error } = await supabase
      .from('injuries')
      .update({ changes: all })
      .eq('id', injury.id)
      .is('healed_on', null)
      .select('id')
    if (error || !still?.length) continue
    injury.changes = all
    await applyChanges(changes)
    changed = true
  }
  return changed
}
