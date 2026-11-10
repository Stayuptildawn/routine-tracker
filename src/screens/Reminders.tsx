import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { Reminder } from '../lib/types'
import { setReminderStatus } from '../lib/actions'
import { t, locale } from '../i18n'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import { Button, Card, Disclosure, EmptyState, ErrorState, ScreenHeader } from '../components/ui'
import { MAX_LEN } from '../lib/limits'

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

const MAX_TEXT = MAX_LEN.note

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

export default function Reminders({
  visible,
  onBack,
  onOpenSettings,
}: {
  visible: boolean
  onBack: () => void
  onOpenSettings: () => void
}) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadedRef = useRef(false)
  const [adding, setAdding] = useState<Draft>({ text: '', category: 'Other', due: '', dueTime: '' })
  const [editing, setEditing] = useState<(Draft & { id: string }) | null>(null)
  const [showCleared, setShowCleared] = useState(false)
  const today = localDate()

  const load = useCallback(async () => {
    const [remindersRes, routinesRes] = await Promise.all([
      supabase.from('reminders').select('*').order('created_at', { ascending: false }).limit(200),
      supabase.from('routines').select('id, name').order('sort_order'),
    ])
    // a failed first load must not pass for "nothing here"; a failed
    // refresh keeps what is already on screen
    if (remindersRes.error) {
      if (!loadedRef.current) setLoadError(true)
      return
    }
    setLoadError(false)
    loadedRef.current = true
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

  /** The category, date and time pickers shared by the add form and the edit form. */
  const whenFields = (d: Draft, set: (patch: Partial<Draft>) => void) => (
    <div className="field-row">
      <select value={d.category} aria-label={t.reminders.title} onChange={(e) => set({ category: e.target.value })}>
        {categories.map((c) => (
          <option key={c.name} value={c.name}>
            {displayCat(c.name)}
          </option>
        ))}
      </select>
      {/* the words "due" and "at" are the hint that these empty-looking
          pickers exist (iOS renders a blank box for an unset date) */}
      <label className="field field--inline" title={t.reminders.dueTitle}>
        <span className="field__label">{t.reminders.due}</span>
        <input type="date" value={d.due} onChange={(e) => set({ due: e.target.value })} />
      </label>
      <label className="field field--inline" title={t.reminders.atTitle}>
        <span className="field__label">{t.reminders.at}</span>
        <input type="time" value={d.dueTime} onChange={(e) => set({ dueTime: e.target.value })} />
      </label>
    </div>
  )

  return (
    <div className="screen reminders">
      <ScreenHeader title={t.reminders.title} lede={t.reminders.subtitle} onBack={onBack} onOpenSettings={onOpenSettings} />

      {loadError && !loaded && <ErrorState onRetry={load} />}
      {!loaded && !loadError && <Skeleton cards={2} />}

      {loaded && (
        <Card>
          <input
            value={adding.text}
            maxLength={MAX_TEXT}
            onChange={(e) => setAdding({ ...adding, text: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addReminder()}
            placeholder={t.reminders.addPh}
            aria-label={t.reminders.addPh}
          />
          {whenFields(adding, (patch) => setAdding({ ...adding, ...patch }))}
          <Button variant="primary" className="reminders__add" onClick={addReminder} disabled={!adding.text.trim()}>
            {t.common.add}
          </Button>
        </Card>
      )}

      {loaded &&
        groups.map(({ cat, items }) => (
          <Card key={cat.name} title={displayCat(cat.name)}>
            <div className="rows">
              {items.map((r) => {
                const due = r.due_date ? describeDue(r.due_date, today) : null
                if (editing?.id === r.id) {
                  return (
                    <div key={r.id} className="row reminder">
                      <input
                        value={editing.text}
                        maxLength={MAX_TEXT}
                        aria-label={t.reminders.addPh}
                        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                        autoFocus
                      />
                      {whenFields(editing, (patch) => setEditing({ ...editing, ...patch }))}
                      {editing.dueTime && <p className="hint">{t.reminders.pushNote(editing.dueTime, !!editing.due)}</p>}
                      <div className="actions">
                        <Button variant="primary" size="sm" onClick={saveEdit} disabled={!editing.text.trim()}>
                          {t.common.save}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                          {t.common.cancel}
                        </Button>
                        {(editing.due || editing.dueTime) && (
                          <Button variant="ghost" size="sm" className="push-end" onClick={() => setEditing({ ...editing, due: '', dueTime: '' })}>
                            {t.common.clear}
                          </Button>
                        )}
                      </div>
                    </div>
                  )
                }
                return (
                  <div key={r.id} className="row reminder">
                    <p>{r.raw_text}</p>
                    <div className="cluster">
                      {due && (
                        <span className={due.overdue ? 'badge badge--accent' : 'badge'}>
                          <Icon name={due.overdue ? 'hourglass' : 'calendar'} /> {due.label}
                          {r.due_time ? ` · ${shortTime(r.due_time)}` : ''}
                        </span>
                      )}
                      {r.status === 'auto' && <span className="badge badge--accent">{t.reminders.aiSorted}</span>}
                      <span className="badge">{displayCat(r.final_category ?? 'Other')}</span>
                    </div>
                    <div className="actions">
                      <Button size="sm" onClick={() => clear(r, 'done')}>
                        {t.common.done}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => clear(r, 'dismissed')}>
                        {t.common.dismiss}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="push-end"
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
                        {t.common.Edit}
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>
        ))}

      {loaded && pending.length === 0 && <EmptyState icon="bell">{t.reminders.nothingPending}</EmptyState>}

      {loaded && cleared.length > 0 && (
        <Disclosure label={t.reminders.cleared(cleared.length)} open={showCleared} onToggle={setShowCleared}>
          <div className="card rows reminders__cleared">
            {cleared.map((r) => (
              <div key={r.id} className="row">
                <div className="row__main">
                  <p className="reminders__cleared-text">{r.raw_text}</p>
                  <p className="cluster">
                    <span className={r.status === 'done' ? 'badge badge--good' : 'badge'}>
                      {r.status === 'done' ? t.reminders.doneBadge : t.reminders.dismissedBadge}
                    </span>
                    <span className="meta">{clearedWhen(r.updated_at)}</span>
                  </p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => restore(r)}>
                  {t.common.Restore}
                </Button>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  )
}
