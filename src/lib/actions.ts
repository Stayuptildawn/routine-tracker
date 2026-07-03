import { supabase } from './supabase'
import { localDate, isoWeekday } from './types'
import type { AppliedAction, InterpretResponse, LogStatus, ReminderStatus } from './types'

const QUEUE_KEY = 'pending_messages'

/** Send free text to the interpret-message edge function. Queues offline. */
export async function interpretMessage(text: string): Promise<InterpretResponse | 'queued'> {
  try {
    const { data, error } = await supabase.functions.invoke<InterpretResponse>('interpret-message', {
      body: { text, date: localDate(), weekday: isoWeekday() },
    })
    if (error) throw error
    return data!
  } catch (err) {
    if (!navigator.onLine) {
      const queue: string[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
      queue.push(text)
      localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
      return 'queued'
    }
    throw err
  }
}

/** Retry messages captured while offline. Returns how many were sent. */
export async function flushMessageQueue(): Promise<number> {
  const queue: string[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
  if (queue.length === 0 || !navigator.onLine) return 0
  localStorage.setItem(QUEUE_KEY, '[]')
  let sent = 0
  for (const text of queue) {
    try {
      await interpretMessage(text)
      sent++
    } catch {
      // put it back and stop; we'll retry on the next 'online' event
      const remaining: string[] = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]')
      localStorage.setItem(QUEUE_KEY, JSON.stringify([text, ...remaining]))
      break
    }
  }
  return sent
}

export function queuedMessageCount(): number {
  return (JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as string[]).length
}

/** Manual tap check-off / skip. */
export async function setTaskStatus(taskId: string, status: LogStatus, via: 'manual' | 'ai_text' = 'manual') {
  const { error } = await supabase
    .from('task_logs')
    .upsert({ task_id: taskId, date: localDate(), status, completed_via: via }, { onConflict: 'task_id,date' })
  if (error) throw error
}

/** Mark a reminder done or dismissed (or back to auto to restore it). */
export async function setReminderStatus(id: string, status: ReminderStatus) {
  const { error } = await supabase
    .from('reminders')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Move a reminder to a different category (routineId null = "Other"). */
export async function reassignReminder(id: string, category: string, routineId: string | null) {
  const { error } = await supabase
    .from('reminders')
    .update({
      final_category: category,
      routine_id: routineId,
      status: 'reassigned',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

/** Revert an entire AI action batch, then mark it undone. */
export async function undoAiAction(aiActionId: string, actions: AppliedAction[]) {
  for (const a of actions) {
    if (a.type === 'check_task' && a.task_id) {
      await supabase
        .from('task_logs')
        .upsert({ task_id: a.task_id, date: localDate(), status: 'pending' }, { onConflict: 'task_id,date' })
    } else if (a.type === 'log_workout' && a.workout_log_id) {
      await supabase.from('workout_logs').delete().eq('id', a.workout_log_id)
    } else if (a.type === 'create_reminder' && a.reminder_id) {
      await supabase.from('reminders').delete().eq('id', a.reminder_id)
    } else if (a.type === 'set_energy') {
      await supabase.from('daily_state').delete().eq('date', localDate())
    }
  }
  await supabase.from('ai_actions').update({ status: 'undone' }).eq('id', aiActionId)
}

export function describeAction(a: AppliedAction): string {
  switch (a.type) {
    case 'check_task':
      return `${a.status === 'skipped' ? '⏭' : '✓'} ${a.label}`
    case 'log_workout': {
      const sets = a.sets?.map((s) => `${s.kg}kg×${s.reps}`).join(', ')
      return `🏋️ ${a.exercise}${sets ? ` — ${sets}` : ''}`
    }
    case 'create_reminder':
      return `🔔 ${a.text} → ${a.category}${a.due_date ? ` (by ${a.due_date})` : ''}`
    case 'set_energy':
      return `🔋 Energy: ${a.level}`
  }
}
