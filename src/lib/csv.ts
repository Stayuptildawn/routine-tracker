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
