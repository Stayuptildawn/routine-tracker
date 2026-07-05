import { supabase } from './supabase'
import type { WorkoutLog } from './types'

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function download(filename: string, rows: unknown[][]) {
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }) // BOM for Excel
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Everything ever logged against tasks, joined to their names. */
export async function exportTaskLogs() {
  const { data, error } = await supabase
    .from('task_logs')
    .select('date, status, completed_via, notes, tasks(label, routines(name))')
    .order('date')
  if (error) throw error
  type Row = { date: string; status: string; completed_via: string | null; notes: string | null; tasks: { label: string; routines: { name: string } | null } | null }
  const rows = (data as unknown as Row[]).map((l) => [
    l.date,
    l.tasks?.routines?.name ?? '',
    l.tasks?.label ?? '(deleted task)',
    l.status,
    l.completed_via ?? '',
    l.notes ?? '',
  ])
  download('task-logs.csv', [['date', 'routine', 'task', 'status', 'via', 'notes'], ...rows])
}

/** Planned training: every set of every session, paged past the 1000-row cap. */
export async function exportTrainingSets() {
  const { data: sessions, error: sErr } = await supabase
    .from('planned_sessions')
    .select('id, week_number, split_day, date, block_id')
    .order('week_number')
  if (sErr) throw sErr
  const { data: blocks } = await supabase.from('training_blocks').select('id, name')
  const blockName = new Map((blocks ?? []).map((b) => [b.id, b.name]))
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]))
  type SetRow = {
    session_id: string
    exercise: string
    muscle_group: string | null
    set_number: number
    target_scheme: string | null
    logged_weight: number | null
    logged_reps: number | null
    logged_at: string | null
  }
  const all: SetRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('planned_sets')
      .select('session_id, exercise, muscle_group, set_number, target_scheme, logged_weight, logged_reps, logged_at')
      .order('id')
      .range(from, from + 999)
    if (error) throw error
    all.push(...((data as SetRow[]) ?? []))
    if (!data || data.length < 1000) break
  }
  const rows = all.map((s) => {
    const sess = sessionById.get(s.session_id)
    return [
      sess ? blockName.get(sess.block_id) ?? '' : '',
      sess?.week_number ?? '',
      sess?.split_day ?? '',
      sess?.date ?? '',
      s.exercise,
      s.muscle_group ?? '',
      s.set_number,
      s.target_scheme ?? '',
      s.logged_weight ?? '',
      s.logged_reps ?? '',
      s.logged_at ? '' + s.logged_at : '',
    ]
  })
  download('training-sets.csv', [
    ['block', 'week', 'session', 'date', 'exercise', 'muscle', 'set', 'target', 'kg', 'reps', 'logged_at'],
    ...rows,
  ])
}

/** Recovery check-ins, joined to their session. */
export async function exportCheckins() {
  const [{ data: checkins, error }, { data: sessions }] = await Promise.all([
    supabase.from('recovery_checkins').select('*').order('created_at'),
    supabase.from('planned_sessions').select('id, week_number, split_day'),
  ])
  if (error) throw error
  const sessionById = new Map((sessions ?? []).map((s) => [s.id, s]))
  type Row = { session_id: string; muscle_group: string; recovery: string | null; effort: string | null; amount: string | null; created_at: string }
  const rows = ((checkins as Row[]) ?? []).map((c) => {
    const s = sessionById.get(c.session_id)
    return [c.created_at.slice(0, 10), s?.split_day ?? '', s?.week_number ?? '', c.muscle_group, c.recovery ?? '', c.effort ?? '', c.amount ?? '']
  })
  download('recovery-checkins.csv', [['date', 'session', 'week', 'muscle', 'recovery', 'effort', 'amount'], ...rows])
}

/** All reminders with their state. */
export async function exportReminders() {
  const { data, error } = await supabase.from('reminders').select('*').order('created_at')
  if (error) throw error
  type Row = { created_at: string; raw_text: string; final_category: string | null; status: string; due_date?: string | null }
  const rows = ((data as Row[]) ?? []).map((r) => [r.created_at.slice(0, 10), r.raw_text, r.final_category ?? '', r.status, r.due_date ?? ''])
  download('reminders.csv', [['created', 'text', 'category', 'status', 'due'], ...rows])
}

/** Every cardio entry. */
export async function exportCardioLogs() {
  const { data, error } = await supabase.from('cardio_logs').select('*').order('date')
  if (error) throw error
  type Row = { date: string; kind: string; minutes: number | null; distance_km: number | null; notes: string | null }
  const rows = ((data as Row[]) ?? []).map((c) => [c.date, c.kind, c.minutes ?? '', c.distance_km ?? '', c.notes ?? ''])
  download('cardio-logs.csv', [['date', 'kind', 'minutes', 'distance_km', 'notes'], ...rows])
}

/** The whole workout logbook, sets flattened to "60kg×8 60kg×8". */
export async function exportWorkoutLogs() {
  const { data, error } = await supabase.from('workout_logs').select('*').order('date')
  if (error) throw error
  const rows = ((data as WorkoutLog[]) ?? []).map((l) => [
    l.date,
    l.week_number ?? '',
    l.split_day ?? '',
    l.exercise,
    l.target_scheme ?? '',
    l.sets?.map((s) => `${s.kg}kg×${s.reps}`).join(' ') ?? '',
    l.notes ?? '',
  ])
  download('workout-logs.csv', [['date', 'week', 'split', 'exercise', 'target', 'sets', 'notes'], ...rows])
}
