import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { Reminder } from '../lib/types'
import { setReminderStatus } from '../lib/actions'
import { t, locale } from '../i18n'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'

interface Category {
  id: string | null // routine id; null = "Other"
  name: string
}

// "Other" is a stored sentinel value (the AI writes it too) - only its
// display is translated, the DB value stays stable
const displayCat = (name: string) => (name === 'Other' ? t.reminders.other : name)

/** "today" / "tomorrow" / "Sat 12 Jul", plus whether it's behind us. */
export function describeDue(due: string, today: string): { label: string; overdue: boolean } {
  if (due === today) return { label: t.reminders.today, overdue: false }
  const dueDate = new Date(due + 'T00:00:00')
  const diffDays = Math.round((dueDate.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 1) return { label: t.reminders.tomorrow, overdue: false }
  const label = dueDate.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' })
  return diffDays < 0 ? { label: t.reminders.since(label), overdue: true } : { label, overdue: false }
}

/** Overdue first (oldest deadline up), then dated, then undated newest-first. */
export function pendingOrder(a: Reminder, b: Reminder): number {
  if (a.due_date && b.due_date) {
    const byDate = a.due_date.localeCompare(b.due_date)
    if (byDate !== 0) return byDate
    return (a.due_time ?? '99').localeCompare(b.due_time ?? '99') // timed before untimed
  }
  if (a.due_date) return -1
  if (b.due_date) return 1
  return b.created_at.localeCompare(a.created_at)
}

/** "12 Jul, 14:32" — when a reminder was cleared (its last status change). */
function clearedWhen(iso: string): string {
  return new Date(iso).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const MAX_TEXT = 300 // long enough for any reminder, short enough to stay a reminder

interface Draft {
  text: string
  category: string
  due: string
  dueTime: string // HH:MM; only meaningful with a date - a push fires then
}

/** "14:30:00" (postgres time) -> "14:30" for display and <input type="time">. */
export function shortTime(time: string): string {
  return time.slice(0, 5)
}

export default function Reminders({ visible, onBack }: { visible: boolean; onBack: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false)
  const [adding, setAdding] = useState<Draft>({ text: '', category: 'Other', due: '', dueTime: '' })
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null)
  const [showCleared, setShowCleared] = useState(false)
  const today = localDate()

  const load = useCallback(async () => {
    const [remindersRes, routinesRes] = await Promise.all([
      supabase.from('reminders').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('routines').select('id, name').order('sort_order'),
    ])
    setReminders((remindersRes.data as Reminder[]) ?? [])
    setCategories([...(routinesRes.data ?? []), { id: null, name: 'Other' }])
    setLoaded(true)
  }, [])

  // refresh whenever the view is shown - silent, the old data stays on screen
  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  useEffect(() => {
    const channel = supabase
      .channel('reminders-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  async function clear(r: Reminder, status: 'done' | 'dismissed') {
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, status } : x)))
    await setReminderStatus(r.id, status)
  }

  async function restore(r: Reminder) {
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'auto' } : x)))
    await setReminderStatus(r.id, 'auto')
  }

  function routineIdFor(category: string): string | null {
    return categories.find((c) => c.name === category)?.id ?? null
  }

  async function addReminder() {
    const text = adding.text.trim().slice(0, MAX_TEXT)
    if (!text) return
    // a time with no date means today - the natural reading of "at 15:00"
    const dueDate = adding.due || (adding.dueTime ? today : '')
    await supabase.from('reminders').insert({
      raw_text: text,
      final_category: adding.category,
      routine_id: routineIdFor(adding.category),
      status: 'reassigned', // user-made, not AI-sorted
      due_date: dueDate || null,
      due_time: adding.dueTime || null,
    })
    setAdding({ ...adding, text: '', due: '', dueTime: '' })
    load()
  }

  async function saveEdit() {
    if (!editing) return
    const text = editing.text.trim().slice(0, MAX_TEXT)
    if (!text) return
    setEditing(null)
    const dueDate = editing.due || (editing.dueTime ? today : '')
    const dueTime = editing.dueTime || null
    setReminders((prev) =>
      prev.map((x) =>
        x.id === editing.id
          ? { ...x, raw_text: text, final_category: editing.category, routine_id: routineIdFor(editing.category), due_date: dueDate || null, due_time: dueTime, status: 'reassigned' }
          : x,
      ),
    )
    await supabase
      .from('reminders')
      .update({
        raw_text: text,
        final_category: editing.category,
        routine_id: routineIdFor(editing.category),
        due_date: dueDate || null,
        due_time: dueTime,
        status: 'reassigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', editing.id)
  }

  const pending = reminders.filter((r) => r.status === 'auto' || r.status === 'reassigned')
  const cleared = reminders.filter((r) => r.status === 'done' || r.status === 'dismissed').slice(0, 20)

  // group pending by category, ordered like the routine list (Other last);
  // categories that no longer match a routine fold into Other
  const groupName = (r: Reminder) => {
    const name = r.final_category ?? 'Other'
    return categories.some((c) => c.name === name) ? name : 'Other'
  }
  const groups = categories
    .map((cat) => ({
      cat,
      items: pending.filter((r) => groupName(r) === cat.name).sort(pendingOrder),
    }))
    .filter((g) => g.items.length > 0)

  return (
    <div className="reminders">
      <button className="link back" onClick={onBack}>
        {t.reminders.back}
      </button>
      <h1>{t.reminders.title}</h1>
      <p className="gentle">{t.reminders.subtitle}</p>

      {loaded && (
        <div className="add-task reminder-add">
          <input
            value={adding.text}
            maxLength={MAX_TEXT}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addReminder()}
            placeholder={t.reminders.addPh}
          />
          <select value={adding.category} onChange={(e) => setAdding({ ...adding, category: e.target.value })}>
            {categories.map((c) => (
              <option key={c.name} value={c.name}>{displayCat(c.name)}</option>
            ))}
          </select>
          <label className="reminder-field" title={t.reminders.dueTitle}>
            <span className="gentle-inline">{t.reminders.due}</span>
            <input type="date" value={adding.due} onChange={(e) => setAdding({ ...adding, due: e.target.value })} />
          </label>
          <label className="reminder-field" title={t.reminders.atTitle}>
            <span className="gentle-inline">{t.reminders.at}</span>
            <input
              type="time"
              value={adding.dueTime}
              onChange={(e) => setAdding({ ...adding, dueTime: e.target.value })}
            />
          </label>
          <button onClick={addReminder} disabled={!adding.text.trim()}>
            {t.common.add}
          </button>
        </div>
      )}

      {!loaded && <Skeleton cards={2} />}

      {loaded &&
        groups.map(({ cat, items }) => (
          <section key={cat.name} className="reminder-group">
            <h2>{displayCat(cat.name)}</h2>
            {items.map((r) => {
              const due = r.due_date ? describeDue(r.due_date, today) : null
              if (editing?.id === r.id) {
                return (
                  <div key={r.id} className="edit-task reminder-edit">
                    <div className="edit-task-row">
                      <input
                        value={editing.text}
                        maxLength={MAX_TEXT}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        autoFocus
                      />
                    </div>
                    <div className="edit-task-row">
                      <select value={editing.category} onChange={(e) => setEditing({ ...editing, category: e.target.value })}>
                        {categories.map((c) => (
                          <option key={c.name} value={c.name}>{displayCat(c.name)}</option>
                        ))}
                      </select>
                      <label className="reminder-field">
                        <span className="gentle-inline">{t.reminders.due}</span>
                        <input
                          type="date"
                          value={editing.due}
                          onChange={(e) => setEditing({ ...editing, due: e.target.value })}
                        />
                      </label>
                      <label className="reminder-field">
                        <span className="gentle-inline">{t.reminders.at}</span>
                        <input
                          type="time"
                          value={editing.dueTime}
                          onChange={(e) => setEditing({ ...editing, dueTime: e.target.value })}
                        />
                      </label>
                      {(editing.due || editing.dueTime) && (
                        <button className="link" onClick={() => setEditing({ ...editing, due: '', dueTime: '' })}>
                          {t.common.clear}
                        </button>
                      )}
                    </div>
                    {editing.dueTime && (
                      <p className="gentle">
                        {t.reminders.pushNote(editing.dueTime, !!editing.due)}
                      </p>
                    )}
                    <div className="edit-task-row">
                      <button className="save" onClick={saveEdit} disabled={!editing.text.trim()}>
                        {t.common.save}
                      </button>
                      <button className="link" onClick={() => setEditing(null)}>
                        {t.common.cancel}
                      </button>
                    </div>
                  </div>
                )
              }
              return (
                <div key={r.id} className="reminder">
                  <div className="reminder-main">
                    <span className="reminder-text">{r.raw_text}</span>
                    <div className="reminder-tags">
                      {due && (
                        <span className={due.overdue ? 'due-pill overdue' : 'due-pill'}>
                          <Icon name={due.overdue ? 'hourglass' : 'calendar'} />{' '}
                          {due.label}
                          {r.due_time ? ` · ${shortTime(r.due_time)}` : ''}
                        </span>
                      )}
                      {r.status === 'auto' && <span className="badge">{t.reminders.aiSorted}</span>}
                      <span className="cat-pill">{displayCat(r.final_category ?? 'Other')}</span>
                      <button
                        className="link reminder-edit-link"
                        onClick={() =>
                          setEditing({
                            id: r.id,
                            text: r.raw_text,
                            category: categories.some((c) => c.name === r.final_category) ? r.final_category! : 'Other',
                            due: r.due_date ?? '',
                            dueTime: r.due_time ? shortTime(r.due_time) : '',
                          })
                        }
                      >
                        {t.common.edit}
                      </button>
                    </div>
                  </div>
                  <div className="task-buttons">
                    <button className="do" onClick={() => clear(r, 'done')}>
                      {t.common.done}
                    </button>
                    <button className="skip" onClick={() => clear(r, 'dismissed')}>
                      {t.common.dismiss}
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        ))}

      {loaded && pending.length === 0 && (
        <p className="gentle">{t.reminders.nothingPending}</p>
      )}

      {loaded && cleared.length > 0 && (
        <div className="cleared-section">
          <button className="link" onClick={() => setShowCleared(!showCleared)}>
            {showCleared ? t.reminders.hideCleared : t.reminders.cleared(cleared.length)}
          </button>
          {showCleared &&
            cleared.map((r) => (
              <div key={r.id} className="reminder cleared">
                <div className="reminder-main">
                  <span className="reminder-text">{r.raw_text}</span>
                  <div className="reminder-tags">
                    <span className={r.status === 'done' ? 'badge confirmed' : 'badge undone'}>
                      {r.status === 'done' ? t.reminders.doneBadge : t.reminders.dismissedBadge}
                    </span>
                    <span className="cleared-when">{clearedWhen(r.updated_at)}</span>
                  </div>
                </div>
                <button className="link" onClick={() => restore(r)}>
                  {t.common.Restore}
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
