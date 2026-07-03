import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { Reminder } from '../lib/types'
import { setReminderStatus, reassignReminder } from '../lib/actions'
import Skeleton from '../components/Skeleton'

interface Category {
  id: string | null // routine id; null = "Other"
  name: string
}

/** "today" / "tomorrow" / "Sat 12 Jul", plus whether it's behind us. */
export function describeDue(due: string, today: string): { label: string; overdue: boolean } {
  if (due === today) return { label: 'today', overdue: false }
  const dueDate = new Date(due + 'T00:00:00')
  const diffDays = Math.round((dueDate.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000)
  if (diffDays === 1) return { label: 'tomorrow', overdue: false }
  const label = dueDate.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  return diffDays < 0 ? { label: `since ${label}`, overdue: true } : { label, overdue: false }
}

/** Overdue first (oldest deadline up), then dated, then undated newest-first. */
export function pendingOrder(a: Reminder, b: Reminder): number {
  if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
  if (a.due_date) return -1
  if (b.due_date) return 1
  return b.created_at.localeCompare(a.created_at)
}

export default function Reminders({ onBack }: { onBack: () => void }) {
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loaded, setLoaded] = useState(false)
  const [reassigning, setReassigning] = useState<string | null>(null)
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

  useEffect(() => {
    load()
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

  async function reassign(r: Reminder, cat: Category) {
    setReassigning(null)
    setReminders((prev) =>
      prev.map((x) =>
        x.id === r.id ? { ...x, final_category: cat.name, routine_id: cat.id, status: 'reassigned' } : x,
      ),
    )
    await reassignReminder(r.id, cat.name, cat.id)
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
        ← Back to Now
      </button>
      <h1>Reminders</h1>
      <p className="gentle">Things you asked to hold onto. Nothing here expires or nags.</p>

      {!loaded && <Skeleton cards={2} />}

      {loaded &&
        groups.map(({ cat, items }) => (
          <section key={cat.name} className="reminder-group">
            <h2>{cat.name}</h2>
            {items.map((r) => {
              const due = r.due_date ? describeDue(r.due_date, today) : null
              return (
                <div key={r.id} className="reminder">
                  <div className="reminder-main">
                    <span className="reminder-text">{r.raw_text}</span>
                    <div className="reminder-tags">
                      {due && (
                        <span className={due.overdue ? 'due-pill overdue' : 'due-pill'}>
                          {due.overdue ? '⏳ ' : '📆 '}
                          {due.label}
                        </span>
                      )}
                      {r.status === 'auto' && <span className="badge">AI-sorted</span>}
                      <button
                        className="cat-pill"
                        onClick={() => setReassigning(reassigning === r.id ? null : r.id)}
                        title="Change category"
                      >
                        {r.final_category ?? 'Other'} ▾
                      </button>
                    </div>
                    {reassigning === r.id && (
                      <div className="chips">
                        <span className="chips-label">Move to:</span>
                        {categories
                          .filter((c) => c.name !== (r.final_category ?? 'Other'))
                          .map((c) => (
                            <button key={c.name} className="chip" onClick={() => reassign(r, c)}>
                              {c.name}
                            </button>
                          ))}
                      </div>
                    )}
                  </div>
                  <div className="task-buttons">
                    <button className="do" onClick={() => clear(r, 'done')}>
                      Done
                    </button>
                    <button className="skip" onClick={() => clear(r, 'dismissed')}>
                      Dismiss
                    </button>
                  </div>
                </div>
              )
            })}
          </section>
        ))}

      {loaded && pending.length === 0 && (
        <p className="gentle">Nothing pending. Say “remind me to…” on the Now tab to add one.</p>
      )}

      {loaded && cleared.length > 0 && (
        <div className="cleared-section">
          <button className="link" onClick={() => setShowCleared(!showCleared)}>
            {showCleared ? 'Hide cleared' : `Cleared (${cleared.length})`}
          </button>
          {showCleared &&
            cleared.map((r) => (
              <div key={r.id} className="reminder cleared">
                <div className="reminder-main">
                  <span className="reminder-text">{r.raw_text}</span>
                  <div className="reminder-tags">
                    <span className={r.status === 'done' ? 'badge confirmed' : 'badge undone'}>
                      {r.status === 'done' ? 'Done' : 'Dismissed'}
                    </span>
                  </div>
                </div>
                <button className="link" onClick={() => restore(r)}>
                  Restore
                </button>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
