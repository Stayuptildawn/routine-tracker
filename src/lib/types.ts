export type Tier = 'core' | 'standard' | 'bonus'
export type LogStatus = 'pending' | 'done' | 'partial' | 'skipped'
export type Energy = 'low' | 'medium' | 'high'

export interface Routine {
  id: string
  name: string
  category: string | null
  sort_order: number | null
  tasks: Task[]
}

export interface Task {
  id: string
  routine_id: string
  label: string
  sort_order: number | null
  scheduled_days: number[]
  tier: Tier
}

export interface TaskLog {
  id: string
  task_id: string
  date: string
  status: LogStatus
  completed_via: string | null
  notes: string | null
}

export interface WorkoutLog {
  id: string
  date: string
  week_number: number | null
  split_day: string | null
  exercise: string
  target_scheme: string | null
  sets: { kg: number; reps: number }[] | null
  notes: string | null
}

export interface AppliedAction {
  type: 'check_task' | 'log_workout' | 'create_reminder' | 'set_energy'
  task_id?: string
  label?: string
  status?: LogStatus
  log_id?: string
  workout_log_id?: string
  exercise?: string
  sets?: { kg: number; reps: number }[] | null
  reminder_id?: string
  text?: string
  category?: string
  level?: Energy
}

export interface Suggestion {
  type: 'check_task'
  task_id: string
  label: string
  status: LogStatus
  confidence: number
}

export interface InterpretResponse {
  ai_action_id: string | null
  applied: AppliedAction[]
  suggestions: Suggestion[]
  error?: string
}

export interface AiAction {
  id: string
  raw_text: string
  actions: AppliedAction[]
  status: 'applied' | 'confirmed' | 'undone'
  created_at: string
}

/** Local date as yyyy-mm-dd (not UTC - the user's day is what matters). */
export function localDate(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** ISO weekday: 1=Mon .. 7=Sun. */
export function isoWeekday(d = new Date()): number {
  return ((d.getDay() + 6) % 7) + 1
}
