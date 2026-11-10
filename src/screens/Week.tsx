import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { usePresence } from '../lib/overlay'
import { localDate } from '../lib/types'
import type { LogStatus, Routine, Task, TaskLog, Tier } from '../lib/types'
import { pendingTaps, setTaskStatus } from '../lib/actions'
import { t } from '../i18n'
import ConfirmButton from '../components/ConfirmButton'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import { Button, Disclosure, ErrorState, ScreenHeader, Sheet, cx } from '../components/ui'
import type { ReactNode } from 'react'
import { MAX_LEN } from '../lib/limits'

const DAY_NAMES = t.week.dayNames
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

const STATUS_GLYPH: Record<string, ReactNode> = {
  done: <Icon name="check" />,
  partial: <Icon name="circle-half" />,
  skipped: <Icon name="minus" />, // deliberately neutral, never a red X
  pending: '',
}

// tap a past cell to fix the record: blank → done → skipped → blank
const NEXT_STATUS: Record<string, LogStatus> = {
  pending: 'done',
  done: 'skipped',
  partial: 'skipped',
  skipped: 'pending',
}

const sortedTasks = (routine: Routine) => [...(routine.tasks ?? [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

export default function Week({ visible, onOpenSettings }: { visible: boolean; onOpenSettings: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [logs, setLogs] = useState<TaskLog[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadedRef = useRef(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [newRoutine, setNewRoutine] = useState('')
  const [addingRoutine, setAddingRoutine] = useState(false)
  // cell taps land here first, keyed `${taskId}|${date}` - nothing is
  // written until the Save bar confirms it
  const [drafts, setDrafts] = useState<Record<string, LogStatus>>({})
  const weekDates = currentWeekDates()
  const today = localDate()

  const load = useCallback(async () => {
    const [routinesRes, logsRes] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, category, sort_order, anchor_time, active, tasks(id, routine_id, label, sort_order, scheduled_days, tier)')
        .order('sort_order'),
      supabase.from('task_logs').select('*').in('date', currentWeekDates()),
    ])
    // a failed first load must not pass for an empty week; a failed refresh
    // keeps what is already on screen
    if (routinesRes.error) {
      if (!loadedRef.current) setLoadError(true)
      return
    }
    setLoadError(false)
    loadedRef.current = true
    setRoutines((routinesRes.data as Routine[]) ?? [])
    let rows = (logsRes.data as TaskLog[]) ?? []
    // marks still waiting on a bad connection win over the server's older answer
    for (const tap of pendingTaps()) {
      const existing = rows.find((l) => l.task_id === tap.task_id && l.date === tap.date)
      rows = existing
        ? rows.map((l) => (l === existing ? { ...l, status: tap.status } : l))
        : [...rows, { id: '', task_id: tap.task_id, date: tap.date, status: tap.status, completed_via: 'manual', notes: null }]
    }
    setLogs(rows)
    setLoaded(true)
  }, [])

  // refresh whenever the tab is shown - silent, the old data stays on screen
  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  // the grid asks for (task, date) once per cell - index instead of scanning
  const logIndex = new Map(logs.map((l) => [`${l.task_id}|${l.date}`, l]))
  const logFor = (taskId: string, date: string) => logIndex.get(`${taskId}|${date}`)

  // On the narrowest phones the table scrolls sideways and starts at Monday,
  // so from Thursday on, today - the column people came to tick - opens
  // off-screen. A stable callback ref, so this runs when the table mounts
  // and never fights the user's own scrolling on later renders.
  const startAtToday = useCallback((wrap: HTMLDivElement | null) => {
    if (!wrap) return
    const todayIdx = (new Date().getDay() + 6) % 7 // 0 = Mon … 6 = Sun
    if (todayIdx < 3) return
    wrap.scrollLeft = wrap.scrollWidth
  }, [])

  function cycleCell(task: Task, date: string) {
    const key = `${task.id}|${date}`
    const saved = logFor(task.id, date)?.status ?? 'pending'
    const next = NEXT_STATUS[drafts[key] ?? saved]
    setDrafts((prev) => {
      // cycled back to what's already saved - drop the draft, nothing to confirm
      if (next === saved) {
        const { [key]: _, ...rest } = prev
        return rest
      }
      return { ...prev, [key]: next }
    })
  }

  const draftCount = Object.keys(drafts).length
  // the save bar keeps its last count while it slides out after save/cancel
  const savebar = usePresence(draftCount > 0)
  const lastCount = useRef(draftCount)
  if (draftCount > 0) lastCount.current = draftCount
  const shownCount = draftCount > 0 ? draftCount : lastCount.current

  async function saveDrafts() {
    const entries = Object.entries(drafts)
    // optimistic: keep the new marks on screen while the writes go out, and
    // keep them if a tap gets queued offline (a reload would revert it)
    setLogs((prev) => {
      let next = prev
      for (const [key, status] of entries) {
        const [taskId, date] = key.split('|')
        const existing = next.find((l) => l.task_id === taskId && l.date === date)
        next = existing
          ? next.map((l) => (l === existing ? { ...l, status } : l))
          : [...next, { id: '', task_id: taskId, date, status, completed_via: 'manual', notes: null }]
      }
      return next
    })
    setDrafts({})
    const results = await Promise.allSettled(
      entries.map(([key, status]) => {
        const [taskId, date] = key.split('|')
        return setTaskStatus(taskId, status, 'manual', date)
      }),
    )
    // a server refusal reloads too, so the grid never shows a mark it lost
    if (results.some((r) => r.status === 'rejected' || r.value === 'saved')) load()
  }

  async function addTask(routineId: string, text: string) {
    const label = text.trim()
    if (!label) return
    const routine = routines.find((r) => r.id === routineId)
    const maxOrder = Math.max(0, ...(routine?.tasks ?? []).map((task) => task.sort_order ?? 0))
    await supabase.from('tasks').insert({ routine_id: routineId, label, sort_order: maxOrder + 1 })
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

  async function renameRoutine(id: string, text: string) {
    const name = text.trim()
    if (name) await supabase.from('routines').update({ name }).eq('id', id)
    load()
  }

  async function setAnchor(routineId: string, value: string) {
    await supabase.from('routines').update({ anchor_time: value || null }).eq('id', routineId)
    load()
  }

  async function setActive(routineId: string, active: boolean) {
    await supabase.from('routines').update({ active }).eq('id', routineId)
    load()
  }

  async function deleteRoutine(routine: Routine) {
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
    await supabase.from('tasks').delete().eq('id', task.id)
    load()
  }

  const active = routines.filter((r) => r.active !== false)
  const paused = routines.filter((r) => r.active === false)

  // the editor keeps showing its routine while the exit transition plays
  const editor = usePresence(editing !== null)
  const lastEditing = useRef(editing)
  if (editing) lastEditing.current = editing
  const editingRoutine = routines.find((r) => r.id === (editing ?? lastEditing.current))

  return (
    <div className={cx('screen week', draftCount > 0 && 'week--has-savebar')}>
      <ScreenHeader title={t.week.title} lede={t.week.subtitle} onOpenSettings={onOpenSettings} />

      {loadError && !loaded && <ErrorState onRetry={load} />}
      {!loaded && !loadError && <Skeleton cards={4} />}

      {loaded && active.length > 0 && (
        <div className="week-table-wrap" ref={startAtToday}>
          <table className="week-table">
            <thead>
              <tr>
                <td />
                {DAY_NAMES.map((d, i) => (
                  <th key={d} scope="col" className={weekDates[i] === today ? 'is-today' : undefined}>
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            {active.map((routine) => {
              const tasks = sortedTasks(routine)
              return (
                <tbody key={routine.id}>
                  <tr className="week-table__group">
                    <th colSpan={8} scope="rowgroup">
                      <div className="week-table__group-head">
                        <h2>{routine.name}</h2>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(routine.id)}>
                          {t.common.Edit}
                        </Button>
                      </div>
                    </th>
                  </tr>
                  {tasks.length === 0 && (
                    <tr>
                      <td colSpan={8} className="hint">
                        {t.week.noDailyTasks}
                      </td>
                    </tr>
                  )}
                  {tasks.map((task) => (
                    <tr key={task.id}>
                      <th scope="row" className="week-table__task">
                        <span>
                          {task.label}
                          {task.tier === 'core' && (
                            <span className="tier-dot" title={t.week.coreDot}>
                              {' '}
                              •
                            </span>
                          )}
                        </span>
                      </th>
                      {weekDates.map((date, i) => {
                        const scheduled = task.scheduled_days.includes(i + 1)
                        const draft = drafts[`${task.id}|${date}`]
                        const status = draft ?? logFor(task.id, date)?.status ?? 'pending'
                        const tappable = scheduled && date <= today
                        const cls = cx(
                          'cell',
                          scheduled ? `cell--${status}` : 'cell--off',
                          date === today && 'is-today',
                          draft && 'cell--draft',
                        )
                        return (
                          <td key={date}>
                            {tappable ? (
                              <button
                                type="button"
                                className={cls}
                                title={t.week.cellTitle(task.label, DAY_NAMES[i])}
                                aria-label={t.week.cellTitle(task.label, DAY_NAMES[i])}
                                onClick={() => cycleCell(task, date)}
                              >
                                {STATUS_GLYPH[status]}
                              </button>
                            ) : (
                              <span className={cls}>{scheduled ? STATUS_GLYPH[status] : ''}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              )
            })}
          </table>
        </div>
      )}

      {loaded && paused.length > 0 && (
        <Disclosure label={t.week.pausedGroup(paused.length)}>
          <div className="card rows week__paused">
            {paused.map((routine) => (
              <div key={routine.id} className="row">
                <span className="row__main">{routine.name}</span>
                <div className="row__end">
                  <Button size="sm" title={t.week.activateTitle} onClick={() => setActive(routine.id, true)}>
                    {t.week.activate}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(routine.id)}>
                    {t.common.Edit}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Disclosure>
      )}

      {loaded &&
        (addingRoutine ? (
          <div className="field-row week__add">
            <input
              className="grow"
              value={newRoutine}
              maxLength={MAX_LEN.name}
              onChange={(e) => setNewRoutine(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addRoutine()}
              onFocus={(e) => e.target.scrollIntoView({ block: 'center', behavior: 'smooth' })}
              placeholder={t.week.newRoutinePh}
              aria-label={t.week.newRoutinePh}
              autoFocus
            />
            <Button variant="primary" onClick={addRoutine} disabled={!newRoutine.trim()}>
              {t.common.add}
            </Button>
            <Button variant="ghost" onClick={() => setAddingRoutine(false)}>
              {t.common.cancel}
            </Button>
          </div>
        ) : (
          <Button variant="ghost" className="week__add" onClick={() => setAddingRoutine(true)}>
            {t.week.addRoutine}
          </Button>
        ))}

      {savebar.mounted && (
        <div className="savebar" data-closing={savebar.closing || undefined} role="status">
          <span className="hint">{t.week.unsavedChanges(shownCount)}</span>
          <Button variant="primary" size="sm" onClick={saveDrafts}>
            {t.common.save}
          </Button>
          <Button size="sm" onClick={() => setDrafts({})}>
            {t.common.cancel}
          </Button>
        </div>
      )}

      {editor.mounted && editingRoutine && (
        <RoutineEditor
          key={editingRoutine.id}
          routine={editingRoutine}
          closing={editor.closing}
          onClose={() => setEditing(null)}
          onRename={(name) => renameRoutine(editingRoutine.id, name)}
          onAnchor={(value) => setAnchor(editingRoutine.id, value)}
          onActive={(on) => setActive(editingRoutine.id, on)}
          onDelete={() => deleteRoutine(editingRoutine)}
          onAddTask={(label) => addTask(editingRoutine.id, label)}
          onUpdateTask={updateTask}
          onToggleDay={toggleDay}
          onDeleteTask={deleteTask}
        />
      )}
    </div>
  )
}

interface EditorProps {
  routine: Routine
  closing: boolean
  onClose: () => void
  onRename: (name: string) => void
  onAnchor: (value: string) => void
  onActive: (active: boolean) => void
  onDelete: () => void
  onAddTask: (label: string) => void
  onUpdateTask: (taskId: string, patch: Partial<Pick<Task, 'label' | 'tier' | 'scheduled_days'>>) => void
  onToggleDay: (task: Task, day: number) => void
  onDeleteTask: (task: Task) => void
}

/** Everything about one routine on a screen of its own: name, anchor time,
 *  pause, its tasks (label, tier, days), and delete. The name is the only
 *  draft (it has a Save button); every other control saves as you change it. */
function RoutineEditor({
  routine,
  closing,
  onClose,
  onRename,
  onAnchor,
  onActive,
  onDelete,
  onAddTask,
  onUpdateTask,
  onToggleDay,
  onDeleteTask,
}: EditorProps) {
  const [nameDraft, setNameDraft] = useState(routine.name)
  const [newLabel, setNewLabel] = useState('')
  const tasks = sortedTasks(routine)
  const paused = routine.active === false
  const nameDirty = nameDraft.trim() !== '' && nameDraft.trim() !== routine.name

  function addTask() {
    if (!newLabel.trim()) return
    onAddTask(newLabel)
    setNewLabel('')
  }

  return (
    <Sheet title={t.common.Edit} label={`${t.common.Edit}: ${routine.name}`} onClose={onClose} closing={closing}>
      <div className="sheet__body">
        <div className="field-row">
          <input
            className="grow routine-editor__name"
            value={nameDraft}
            maxLength={MAX_LEN.name}
            aria-label={t.week.newRoutinePh}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && nameDirty && onRename(nameDraft)}
          />
          <Button variant="primary" onClick={() => onRename(nameDraft)} disabled={!nameDirty}>
            {t.common.save}
          </Button>
        </div>

        <div className="field field--inline">
          <label className="field__label" htmlFor={`anchor-${routine.id}`}>
            {t.week.anchorTime}
          </label>
          <input
            id={`anchor-${routine.id}`}
            type="time"
            value={routine.anchor_time?.slice(0, 5) ?? ''}
            onChange={(e) => onAnchor(e.target.value)}
            title={t.week.anchorTitle}
          />
          {routine.anchor_time ? (
            <Button variant="ghost" size="sm" onClick={() => onAnchor('')}>
              {t.common.clear}
            </Button>
          ) : (
            <span className="hint">{t.week.anchorHint}</span>
          )}
        </div>

        <div className="field field--inline">
          <Button onClick={() => onActive(paused)}>{paused ? t.week.activate : t.week.pause}</Button>
          <span className="hint">{paused ? t.week.activateTitle : t.week.pauseTitle}</span>
        </div>

        {tasks.map((task) => (
          <div key={task.id} className="card edit-item">
            <div className="field-row field-row--tight">
              <input
                className="grow"
                defaultValue={task.label}
                maxLength={MAX_LEN.label}
                aria-label={t.week.newTaskPh}
                onBlur={(e) => {
                  const label = e.target.value.trim()
                  if (label && label !== task.label) onUpdateTask(task.id, { label })
                }}
              />
              <select
                value={task.tier}
                onChange={(e) => onUpdateTask(task.id, { tier: e.target.value as Tier })}
                title={t.week.tierTitle}
                aria-label={t.week.tierTitle}
              >
                {TIERS.map((tier) => (
                  <option key={tier} value={tier}>
                    {t.tiers[tier]}
                  </option>
                ))}
              </select>
              <ConfirmButton
                iconOnly
                label={<Icon name="x" />}
                confirmLabel={t.week.deleteTaskConfirm}
                title={t.week.deleteTaskTitle(task.label)}
                onConfirm={() => onDeleteTask(task)}
              />
            </div>
            <div className="chips chips--days">
              {DAY_NAMES.map((d, i) => {
                const on = task.scheduled_days.includes(i + 1)
                return (
                  <button
                    key={d}
                    type="button"
                    className="chip"
                    aria-pressed={on}
                    onClick={() => onToggleDay(task, i + 1)}
                    title={on ? t.week.scheduledDay(d) : t.week.notScheduledDay(d)}
                    aria-label={on ? t.week.scheduledDay(d) : t.week.notScheduledDay(d)}
                  >
                    {t.week.dayNamesShort[i]}
                  </button>
                )
              })}
            </div>
          </div>
        ))}

        <div className="field-row">
          <input
            className="grow"
            value={newLabel}
            maxLength={MAX_LEN.label}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addTask()}
            placeholder={t.week.newTaskPh}
            aria-label={t.week.newTaskPh}
          />
          <Button onClick={addTask} disabled={!newLabel.trim()}>
            {t.common.add}
          </Button>
        </div>

        <ConfirmButton
          className="routine-editor__delete"
          label={t.week.deleteRoutine}
          confirmLabel={t.week.deleteRoutineConfirm}
          onConfirm={onDelete}
        />
      </div>
    </Sheet>
  )
}
