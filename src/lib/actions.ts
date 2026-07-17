import { supabase } from './supabase'
import { localDate, isoWeekday } from './types'
import type { AppliedAction, InterpretResponse, LogStatus, ReminderStatus } from './types'
import type { IconName } from '../components/Icon'
import { t, lang } from '../i18n'

const QUEUE_KEY = 'pending_messages'

/** Send free text to the interpret-message edge function. Queues offline. */
export async function interpretMessage(text: string): Promise<InterpretResponse | 'queued'> {
  try {
    const { data, error } = await supabase.functions.invoke<InterpretResponse>('interpret-message', {
      body: { text, date: localDate(), weekday: isoWeekday(), time: new Date().toTimeString().slice(0, 5), lang },
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

/** On-demand, kind-but-truthful read of the training PATTERN over ~12 weeks. */
export async function trainingReflection(): Promise<{ comment: string; noData: boolean }> {
  const { data, error } = await supabase.functions.invoke<{ comment?: string; noData?: boolean; error?: string }>(
    'training-reflection',
    { body: { date: localDate() } },
  )
  if (error) throw error
  if (data?.error) throw new Error(data.error)
  return { comment: data?.comment ?? '', noData: !!data?.noData }
}

export function queuedMessageCount(): number {
  return (JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as string[]).length
}

const TAP_QUEUE_KEY = 'pending_taps'

interface QueuedTap {
  task_id: string
  date: string
  status: LogStatus
  via: string
}

/** Manual tap check-off / skip. Queues offline instead of failing. */
export async function setTaskStatus(
  taskId: string,
  status: LogStatus,
  via: 'manual' | 'ai_text' = 'manual',
  date = localDate(),
): Promise<'saved' | 'queued'> {
  try {
    const { error } = await supabase
      .from('task_logs')
      .upsert(
        { task_id: taskId, date, status, completed_via: via, logged_at: new Date().toISOString() },
        { onConflict: 'task_id,date' },
      )
    if (error) throw error
    return 'saved'
  } catch (err) {
    if (!navigator.onLine) {
      queueTap({ task_id: taskId, date, status, via })
      return 'queued'
    }
    throw err
  }
}

/** Last-write-wins per (task_id, date): a re-tap replaces the queued one. */
function queueTap(tap: QueuedTap) {
  const queue: QueuedTap[] = JSON.parse(localStorage.getItem(TAP_QUEUE_KEY) ?? '[]')
  const rest = queue.filter((t) => !(t.task_id === tap.task_id && t.date === tap.date))
  localStorage.setItem(TAP_QUEUE_KEY, JSON.stringify([...rest, tap]))
}

/** Retry taps captured while offline. Returns how many were saved. */
export async function flushTapQueue(): Promise<number> {
  const queue: QueuedTap[] = JSON.parse(localStorage.getItem(TAP_QUEUE_KEY) ?? '[]')
  if (queue.length === 0 || !navigator.onLine) return 0
  localStorage.setItem(TAP_QUEUE_KEY, '[]')
  let sent = 0
  for (const [i, tap] of queue.entries()) {
    try {
      const { error } = await supabase
        .from('task_logs')
        .upsert(
          { task_id: tap.task_id, date: tap.date, status: tap.status, completed_via: tap.via, logged_at: new Date().toISOString() },
          { onConflict: 'task_id,date' },
        )
      // server rejected it (e.g. the task was deleted meanwhile) - drop it,
      // retrying can never succeed
      if (error) continue
      sent++
    } catch {
      // network dropped again: put the rest back, retry on the next 'online'
      const remaining: QueuedTap[] = JSON.parse(localStorage.getItem(TAP_QUEUE_KEY) ?? '[]')
      localStorage.setItem(TAP_QUEUE_KEY, JSON.stringify([...queue.slice(i), ...remaining]))
      break
    }
  }
  return sent
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
    if (a.type === 'check_task' && a.log_id) {
      // by log id, so a past-day check ("did X yesterday") reverts the right row
      await supabase.from('task_logs').update({ status: 'pending' }).eq('id', a.log_id)
    } else if (a.type === 'check_task' && a.task_id) {
      await supabase
        .from('task_logs')
        .upsert({ task_id: a.task_id, date: a.log_date ?? localDate(), status: 'pending' }, { onConflict: 'task_id,date' })
    } else if (a.type === 'log_workout' && a.planned_set_ids?.length) {
      // NL-filled planned sets: clear them and reopen the session
      await supabase
        .from('planned_sets')
        .update({ logged_weight: null, logged_reps: null, logged_at: null })
        .in('id', a.planned_set_ids)
      const { data: row } = await supabase
        .from('planned_sets')
        .select('session_id')
        .eq('id', a.planned_set_ids[0])
        .maybeSingle()
      if (row) await supabase.from('planned_sessions').update({ completed_at: null }).eq('id', row.session_id)
    } else if (a.type === 'log_workout' && a.workout_log_id) {
      await supabase.from('workout_logs').delete().eq('id', a.workout_log_id)
    } else if (a.type === 'log_cardio' && a.cardio_log_id) {
      await supabase.from('cardio_logs').delete().eq('id', a.cardio_log_id)
    } else if (a.type === 'create_reminder' && a.reminder_id) {
      await supabase.from('reminders').delete().eq('id', a.reminder_id)
    } else if (a.type === 'complete_reminder' && a.reminder_id) {
      // restore whatever status the reminder had before the AI cleared it
      await setReminderStatus(a.reminder_id, a.prev_status ?? 'auto')
    } else if (a.type === 'set_energy') {
      await supabase.from('daily_state').delete().eq('date', localDate())
    }
  }
  await supabase.from('ai_actions').update({ status: 'undone' }).eq('id', aiActionId)
}

export function describeAction(a: AppliedAction): { icon: IconName; text: string } {
  switch (a.type) {
    case 'check_task':
      return { icon: a.status === 'skipped' ? 'skip' : 'check', text: a.label ?? '' }
    case 'log_workout': {
      const sets = a.sets?.map((s) => t.actions.setKgReps(s.kg, s.reps)).join(', ')
      const planned = a.planned_set_ids ? t.actions.plannedSession(a.split_day ?? '') : ''
      return { icon: 'dumbbell', text: `${a.exercise}${sets ? ` — ${sets}` : ''}${planned}` }
    }
    case 'log_cardio':
      return {
        icon: 'run',
        text: `${a.kind}${a.distance_km ? ` ${a.distance_km}km` : ''}${a.minutes ? ` · ${t.now.minutes(a.minutes)}` : ''}`,
      }
    case 'create_reminder':
      return {
        icon: 'bell',
        text: t.actions.reminderTo(
          a.text ?? '',
          a.category ?? '',
          a.due_date ? t.actions.reminderDue(a.due_date, a.due_time ? a.due_time.slice(0, 5) : '') : '',
        ),
      }
    case 'complete_reminder':
      return {
        icon: 'check',
        text: a.reminder_status === 'dismissed' ? t.actions.dropped(a.text ?? '') : t.actions.cleared(a.text ?? ''),
      }
    case 'set_energy':
      return { icon: 'battery-medium', text: t.actions.energy(a.level ?? '') }
  }
}
