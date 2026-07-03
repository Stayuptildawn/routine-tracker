import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { Routine, TaskLog } from '../lib/types'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Dates (yyyy-mm-dd) for Monday..Sunday of the current week. */
function currentWeekDates(): string[] {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return localDate(d)
  })
}

const STATUS_GLYPH: Record<string, string> = {
  done: '✓',
  partial: '◐',
  skipped: '–', // deliberately neutral, never a red X
  pending: '',
}

export default function Week() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [newTaskFor, setNewTaskFor] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const weekDates = currentWeekDates()
  const today = localDate()

  const load = useCallback(async () => {
    const [routinesRes, logsRes] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, category, sort_order, tasks(id, routine_id, label, sort_order, scheduled_days, tier)')
        .order('sort_order'),
      supabase.from('task_logs').select('*').in('date', currentWeekDates()),
    ])
    setRoutines((routinesRes.data as Routine[]) ?? [])
    setLogs((logsRes.data as TaskLog[]) ?? [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const logFor = (taskId: string, date: string) =>
    logs.find((l) => l.task_id === taskId && l.date === date)

  async function addTask(routineId: string) {
    const label = newLabel.trim()
    if (!label) return
    await supabase.from('tasks').insert({ routine_id: routineId, label })
    setNewLabel('')
    setNewTaskFor(null)
    load()
  }

  return (
    <div className="week">
      <h1>This week</h1>
      <p className="gentle">A record, not a scorecard. Blanks are neutral.</p>
      {routines
        .filter((r) => (r.tasks ?? []).length > 0)
        .map((routine) => (
          <section key={routine.id} className="week-routine">
            <h2>{routine.name}</h2>
            <div className="week-grid-wrap">
              <table className="week-grid">
                <thead>
                  <tr>
                    <th></th>
                    {DAY_NAMES.map((d, i) => (
                      <th key={d} className={weekDates[i] === today ? 'today' : ''}>
                        {d}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(routine.tasks ?? [])
                    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                    .map((task) => (
                      <tr key={task.id}>
                        <td className="task-name">
                          {task.label}
                          {task.tier === 'core' && <span className="tier-dot" title="core">•</span>}
                        </td>
                        {weekDates.map((date, i) => {
                          const scheduled = task.scheduled_days.includes(i + 1)
                          const status = logFor(task.id, date)?.status ?? 'pending'
                          return (
                            <td
                              key={date}
                              className={`cell ${status} ${scheduled ? '' : 'unscheduled'} ${date === today ? 'today' : ''}`}
                            >
                              {scheduled ? STATUS_GLYPH[status] : ''}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {newTaskFor === routine.id ? (
              <div className="add-task">
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addTask(routine.id)}
                  placeholder="New task label"
                  autoFocus
                />
                <button onClick={() => addTask(routine.id)}>Add</button>
                <button className="link" onClick={() => setNewTaskFor(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <button className="link" onClick={() => setNewTaskFor(routine.id)}>
                + Add task
              </button>
            )}
          </section>
        ))}
    </div>
  )
}
