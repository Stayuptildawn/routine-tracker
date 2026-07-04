import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { LogStatus, Routine, Task, TaskLog, Tier } from '../lib/types'
import { setTaskStatus } from '../lib/actions'
import Skeleton from '../components/Skeleton'

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIERS: Tier[] = ['core', 'standard', 'bonus']

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

// tap a past cell to fix the record: blank → done → skipped → blank
const NEXT_STATUS: Record<string, LogStatus> = {
  pending: 'done',
  done: 'skipped',
  partial: 'skipped',
  skipped: 'pending',
}

export default function Week() {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [loaded, setLoaded] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState('')
  const [newTaskFor, setNewTaskFor] = useState<string | null>(null)
  const [newLabel, setNewLabel] = useState('')
  const [newRoutine, setNewRoutine] = useState('')
  const [addingRoutine, setAddingRoutine] = useState(false)
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
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const logFor = (taskId: string, date: string) =>
    logs.find((l) => l.task_id === taskId && l.date === date)

  async function cycleCell(task: Task, date: string) {
    const next = NEXT_STATUS[logFor(task.id, date)?.status ?? 'pending']
    // optimistic: show the change instantly, and keep it if the tap gets
    // queued offline (a reload would revert it)
    setLogs((prev) => {
      const existing = prev.find((l) => l.task_id === task.id && l.date === date)
      if (existing) return prev.map((l) => (l === existing ? { ...l, status: next } : l))
      return [
        ...prev,
        { id: '', task_id: task.id, date, status: next, completed_via: 'manual', notes: null },
      ]
    })
    if ((await setTaskStatus(task.id, next, 'manual', date)) === 'saved') load()
  }

  async function addTask(routineId: string) {
    const label = newLabel.trim()
    if (!label) return
    const routine = routines.find((r) => r.id === routineId)
    const maxOrder = Math.max(0, ...(routine?.tasks ?? []).map((t) => t.sort_order ?? 0))
    await supabase.from('tasks').insert({ routine_id: routineId, label, sort_order: maxOrder + 1 })
    setNewLabel('')
    setNewTaskFor(null)
    load()
  }

  async function addRoutine() {
    const name = newRoutine.trim()
    if (!name) return
    const maxOrder = Math.max(0, ...routines.map((r) => r.sort_order ?? 0))
    await supabase.from('routines').insert({ name, sort_order: maxOrder + 1 })
    setNewRoutine('')
    setAddingRoutine(false)
    load()
  }

  async function renameRoutine(id: string) {
    const name = nameDraft.trim()
    if (name) await supabase.from('routines').update({ name }).eq('id', id)
    setEditing(null)
    load()
  }

  async function deleteRoutine(routine: Routine) {
    if (!window.confirm(`Delete "${routine.name}" and all its tasks and history?`)) return
    await supabase.from('routines').delete().eq('id', routine.id)
    setEditing(null)
    load()
  }

  async function updateTask(taskId: string, patch: Partial<Pick<Task, 'label' | 'tier' | 'scheduled_days'>>) {
    await supabase.from('tasks').update(patch).eq('id', taskId)
    load()
  }

  function toggleDay(task: Task, day: number) {
    const days = task.scheduled_days.includes(day)
      ? task.scheduled_days.filter((d) => d !== day)
      : [...task.scheduled_days, day].sort((a, b) => a - b)
    if (days.length === 0) return // a task needs at least one day
    updateTask(task.id, { scheduled_days: days })
  }

  async function deleteTask(task: Task) {
    if (!window.confirm(`Delete task "${task.label}"?`)) return
    await supabase.from('tasks').delete().eq('id', task.id)
    load()
  }

  return (
    <div className="week">
      <h1>This week</h1>
      <p className="gentle">A record, not a scorecard. Blanks are neutral.</p>
      {!loaded && <Skeleton cards={4} />}
      {routines.map((routine) => {
        const tasks = (routine.tasks ?? []).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        const isEditing = editing === routine.id
        return (
          <section key={routine.id} className="week-routine">
            <div className="routine-header">
              {isEditing ? (
                <div className="rename-row">
                  <input
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && renameRoutine(routine.id)}
                    autoFocus
                  />
                  <button className="save" onClick={() => renameRoutine(routine.id)}>
                    Save
                  </button>
                </div>
              ) : (
                <h2>{routine.name}</h2>
              )}
              <button
                className="link"
                onClick={() => {
                  if (isEditing) {
                    setEditing(null)
                  } else {
                    setEditing(routine.id)
                    setNameDraft(routine.name)
                  }
                }}
              >
                {isEditing ? 'Done' : 'Edit'}
              </button>
            </div>

            {isEditing ? (
              <div className="edit-panel">
                {tasks.map((task) => (
                  <div key={task.id} className="edit-task">
                    <div className="edit-task-row">
                      <input
                        defaultValue={task.label}
                        onBlur={(e) => {
                          const label = e.target.value.trim()
                          if (label && label !== task.label) updateTask(task.id, { label })
                        }}
                      />
                      <select
                        value={task.tier}
                        onChange={(e) => updateTask(task.id, { tier: e.target.value as Tier })}
                        title="core = shown even on low-energy days"
                      >
                        {TIERS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                      <button className="danger" onClick={() => deleteTask(task)}>
                        ✕
                      </button>
                    </div>
                    <div className="day-picker">
                      {DAY_NAMES.map((d, i) => (
                        <button
                          key={d}
                          className={task.scheduled_days.includes(i + 1) ? 'day on' : 'day'}
                          onClick={() => toggleDay(task, i + 1)}
                          title={task.scheduled_days.includes(i + 1) ? `scheduled ${d}` : `not scheduled ${d}`}
                        >
                          {d.slice(0, 2)}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="add-task">
                  <input
                    value={newTaskFor === routine.id ? newLabel : ''}
                    onFocus={() => setNewTaskFor(routine.id)}
                    onChange={(e) => setNewLabel(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addTask(routine.id)}
                    placeholder="New task label"
                  />
                  <button onClick={() => addTask(routine.id)}>Add</button>
                </div>
                <button className="danger delete-routine" onClick={() => deleteRoutine(routine)}>
                  Delete this routine
                </button>
              </div>
            ) : tasks.length > 0 ? (
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
                    {tasks.map((task) => (
                      <tr key={task.id}>
                        <td className="task-name">
                          {task.label}
                          {task.tier === 'core' && <span className="tier-dot" title="core">•</span>}
                        </td>
                        {weekDates.map((date, i) => {
                          const scheduled = task.scheduled_days.includes(i + 1)
                          const status = logFor(task.id, date)?.status ?? 'pending'
                          const tappable = scheduled && date <= today
                          return (
                            <td
                              key={date}
                              className={`cell ${status} ${scheduled ? '' : 'unscheduled'} ${date === today ? 'today' : ''} ${tappable ? 'tappable' : ''}`}
                              role={tappable ? 'button' : undefined}
                              tabIndex={tappable ? 0 : undefined}
                              title={tappable ? `${task.label} — tap to edit ${DAY_NAMES[i]}` : undefined}
                              onClick={tappable ? () => cycleCell(task, date) : undefined}
                              onKeyDown={
                                tappable
                                  ? (e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault()
                                        cycleCell(task, date)
                                      }
                                    }
                                  : undefined
                              }
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
            ) : (
              <p className="gentle">No daily tasks — used as a reminder category.</p>
            )}
          </section>
        )
      })}

      {addingRoutine ? (
        <div className="add-task add-routine">
          <input
            value={newRoutine}
            onChange={(e) => setNewRoutine(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addRoutine()}
            placeholder="New routine name"
            autoFocus
          />
          <button onClick={addRoutine}>Add</button>
          <button className="link" onClick={() => setAddingRoutine(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="link add-routine" onClick={() => setAddingRoutine(true)}>
          + Add routine
        </button>
      )}
    </div>
  )
}
