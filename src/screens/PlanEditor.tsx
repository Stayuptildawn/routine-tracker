import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { PlannedSession, TrainingBlock, WorkoutPlan } from '../lib/types'

export const MUSCLE_GROUPS = ['Chest', 'Shoulders', 'Triceps', 'Back', 'Biceps', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Other']
export const PHASE_KEYS = ['1-2', '3-4', '5-6']

/** What a Save changed structurally in the running block's plan - Gym uses it
 *  to offer "apply to this block's remaining sessions too?". */
export interface BlockApplyDiff {
  added: { exercise: string; muscle_group: string; schemes: Record<string, string>; split_day: string }[]
  removed: { exercise: string; split_day: string }[]
}

interface DraftRow {
  key: string // stable render key: the db id, or a temp uuid for new rows
  id: string | null // null = added in this edit
  split_day: string
  exercise: string
  muscle: string
  schemes: Record<string, string>
  note: string
  deleted: boolean // marked for deletion, undoable until Save
}

interface Props {
  origin: WorkoutPlan[] // this block's rows as they are in the db
  planBlock: number
  activeBlock: TrainingBlock | null
  sessions: PlannedSession[] // the active block's sessions (rename propagation scope)
  initialSplit: string | null
  onCancel: () => void
  onSaved: (split: string | null, diff: BlockApplyDiff | null) => void
}

/** Draft-based plan editor: every change - fields, adds, deletes, reorders -
 *  lives in local state until Save writes it all at once. Cancel discards
 *  everything, which is why deletes here don't need their own confirm. */
export default function PlanEditor({ origin, planBlock, activeBlock, sessions, initialSplit, onCancel, onSaved }: Props) {
  const [rows, setRows] = useState<DraftRow[]>(() =>
    origin.map((p) => ({
      key: p.id,
      id: p.id,
      split_day: p.split_day,
      exercise: p.exercise,
      muscle: p.muscle_group ?? 'Other',
      schemes: { ...(p.schemes ?? {}) },
      note: p.safety_note ?? '',
      deleted: false,
    })),
  )
  const [split, setSplit] = useState<string | null>(initialSplit ?? origin[0]?.split_day ?? null)
  const [newSession, setNewSession] = useState('')
  const [newEx, setNewEx] = useState({ name: '', muscle: 'Other', scheme: '3 x 10-12' })
  const [saving, setSaving] = useState(false)

  const splits = [...new Set(rows.map((r) => r.split_day))]
  const tabs = split && !splits.includes(split) ? [...splits, split] : splits
  const splitRows = rows.filter((r) => r.split_day === split)
  const visibleSplitKeys = splitRows.filter((r) => !r.deleted).map((r) => r.key)

  function patch(key: string, p: Partial<DraftRow>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...p } : r)))
  }

  function remove(key: string) {
    setRows((prev) => {
      const r = prev.find((x) => x.key === key)
      if (!r) return prev
      // a row added in this edit just vanishes; a db row is struck through until Save
      if (!r.id) return prev.filter((x) => x.key !== key)
      return prev.map((x) => (x.key === key ? { ...x, deleted: true } : x))
    })
  }

  function move(key: string, dir: -1 | 1) {
    setRows((prev) => {
      const keys = prev.filter((r) => r.split_day === split && !r.deleted).map((r) => r.key)
      const i = keys.indexOf(key)
      const j = i + dir
      if (i === -1 || j < 0 || j >= keys.length) return prev
      const a = prev.findIndex((r) => r.key === keys[i])
      const b = prev.findIndex((r) => r.key === keys[j])
      const next = [...prev]
      ;[next[a], next[b]] = [next[b], next[a]]
      return next
    })
  }

  function addExercise() {
    const name = newEx.name.trim()
    if (!name || !split) return
    setRows((prev) => [
      ...prev,
      {
        key: crypto.randomUUID(),
        id: null,
        split_day: split,
        exercise: name,
        muscle: newEx.muscle,
        schemes: { '1-2': newEx.scheme, '3-4': newEx.scheme, '5-6': newEx.scheme },
        note: '',
        deleted: false,
      },
    ])
    setNewEx({ ...newEx, name: '' })
  }

  async function save() {
    if (saving) return
    setSaving(true)
    try {
      const origById = new Map(origin.map((p) => [p.id, p]))
      const surviving = rows.filter((r) => !r.deleted && r.exercise.trim())
      // final order: one global sequence, split by split in tab order - the
      // session pills derive their order from it, so it must stay grouped
      const orderOf = new Map<string, number>()
      const splitOrder = [...new Set(rows.map((r) => r.split_day))]
      let n = 0
      for (const s of splitOrder) {
        for (const r of surviving.filter((x) => x.split_day === s)) orderOf.set(r.key, ++n)
      }

      const toDelete = rows.filter((r) => r.deleted && r.id).map((r) => r.id!)
      if (toDelete.length > 0) await supabase.from('workout_plans').delete().in('id', toDelete)

      const inserts = surviving
        .filter((r) => !r.id)
        .map((r) => ({
          block: planBlock,
          split_day: r.split_day,
          sort_order: orderOf.get(r.key),
          exercise: r.exercise.trim(),
          muscle_group: r.muscle,
          schemes: r.schemes,
          safety_note: r.note.trim() || null,
        }))
      if (inserts.length > 0) await supabase.from('workout_plans').insert(inserts)

      for (const r of surviving) {
        if (!r.id) continue
        const o = origById.get(r.id)
        if (!o) continue
        const changes: Record<string, unknown> = {}
        const name = r.exercise.trim()
        if (name !== o.exercise) changes.exercise = name
        if (r.muscle !== (o.muscle_group ?? 'Other')) changes.muscle_group = r.muscle
        if (JSON.stringify(r.schemes) !== JSON.stringify(o.schemes ?? {})) changes.schemes = r.schemes
        if ((r.note.trim() || null) !== (o.safety_note ?? null)) changes.safety_note = r.note.trim() || null
        if (orderOf.get(r.key) !== o.sort_order) changes.sort_order = orderOf.get(r.key)
        if (Object.keys(changes).length === 0) continue
        await supabase.from('workout_plans').update(changes).eq('id', r.id)
        // a rename or muscle fix reaches the running block's not-yet-logged
        // sets (they match plans by exercise name); logged sets keep the name
        // they were performed under
        if (activeBlock && planBlock === activeBlock.block && (changes.exercise || changes.muscle_group)) {
          const sessionIds = sessions.filter((s) => s.split_day === o.split_day).map((s) => s.id)
          if (sessionIds.length > 0) {
            const values: Record<string, string> = {}
            if (changes.exercise) values.exercise = changes.exercise as string
            if (changes.muscle_group) values.muscle_group = changes.muscle_group as string
            await supabase
              .from('planned_sets')
              .update(values)
              .eq('exercise', o.exercise)
              .is('logged_at', null)
              .in('session_id', sessionIds)
          }
        }
      }

      // structural changes to the running block's plan? Gym offers to apply
      // them to the remaining sessions instead of only the next block.
      let diff: BlockApplyDiff | null = null
      if (activeBlock && planBlock === activeBlock.block) {
        const added = surviving
          .filter((r) => !r.id)
          .map((r) => ({ exercise: r.exercise.trim(), muscle_group: r.muscle, schemes: r.schemes, split_day: r.split_day }))
        const removed = rows
          .filter((r) => r.deleted && r.id)
          .map((r) => ({ exercise: origById.get(r.id!)!.exercise, split_day: r.split_day }))
        if (added.length > 0 || removed.length > 0) diff = { added, removed }
      }
      onSaved(split, diff)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="edit-panel">
      <div className="edit-task-row plan-edit-actions">
        <button className="save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="link" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
      <p className="gentle">
        Nothing is saved until you press Save — Cancel walks away untouched. Renames and notes reach this block's
        remaining sets; you'll be asked about added or removed exercises.
      </p>

      <div className="energy-row plan-row">
        <span className="energy-label">Session</span>
        {tabs.map((s) => (
          <button key={s} className={s === split ? 'energy-btn active' : 'energy-btn'} onClick={() => setSplit(s)}>
            {s}
          </button>
        ))}
      </div>

      {splitRows.map((r) => {
        if (r.deleted) {
          return (
            <div key={r.key} className="edit-task-row plan-deleted">
              <span className="plan-deleted-name">{r.exercise}</span>
              <button className="link" onClick={() => patch(r.key, { deleted: false })}>
                restore
              </button>
            </div>
          )
        }
        const pos = visibleSplitKeys.indexOf(r.key)
        return (
          <div key={r.key} className="edit-task">
            <div className="edit-task-row">
              <input value={r.exercise} onChange={(e) => patch(r.key, { exercise: e.target.value })} />
              <select value={r.muscle} onChange={(e) => patch(r.key, { muscle: e.target.value })}>
                {MUSCLE_GROUPS.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <button className="danger" disabled={pos === 0} onClick={() => move(r.key, -1)}>
                ↑
              </button>
              <button className="danger" disabled={pos === visibleSplitKeys.length - 1} onClick={() => move(r.key, 1)}>
                ↓
              </button>
              <button className="danger" title="Remove (undoable until Save)" onClick={() => remove(r.key)}>
                ✕
              </button>
            </div>
            <div className="edit-task-row scheme-row">
              {PHASE_KEYS.map((k) => (
                <input
                  key={k}
                  value={r.schemes[k] ?? ''}
                  placeholder={`wk ${k}`}
                  onChange={(e) => patch(r.key, { schemes: { ...r.schemes, [k]: e.target.value } })}
                />
              ))}
            </div>
            <div className="edit-task-row">
              <input
                value={r.note}
                placeholder="🛡 note / form cue (shown in sessions)"
                onChange={(e) => patch(r.key, { note: e.target.value })}
              />
            </div>
          </div>
        )
      })}

      <div className="add-task">
        <input
          value={newSession}
          onChange={(e) => setNewSession(e.target.value)}
          placeholder="New session name (e.g. Upper C)"
        />
        <button
          onClick={() => {
            const v = newSession.trim()
            if (!v) return
            setSplit(v)
            setNewSession('')
          }}
        >
          Add session
        </button>
      </div>
      <div className="add-task">
        <input
          value={newEx.name}
          onChange={(e) => setNewEx({ ...newEx, name: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && addExercise()}
          placeholder={`New exercise for ${split ?? '…'}`}
        />
        <select value={newEx.muscle} onChange={(e) => setNewEx({ ...newEx, muscle: e.target.value })}>
          {MUSCLE_GROUPS.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button onClick={addExercise}>Add</button>
      </div>
    </div>
  )
}
