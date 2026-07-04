import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { PlannedSession, PlannedSet, WorkoutPlan } from '../lib/types'

interface Props {
  session: PlannedSession
  plans: WorkoutPlan[] // for neck cues
  onExit: () => void
}

interface Draft {
  weight: string
  reps: string
}

// recovery check-in, in this app's voice - three quick questions per muscle
const CHECKIN_QUESTIONS: { field: 'recovery' | 'effort' | 'amount'; label: string; options: [string, string][] }[] = [
  {
    field: 'recovery',
    label: 'Recovered from last time?',
    options: [
      ['fresh', 'Fresh the whole time'],
      ['ready_days_ago', 'Ready days ago'],
      ['just_in_time', 'Just in time'],
      ['still_worn', 'Still worn'],
    ],
  },
  {
    field: 'effort',
    label: 'How hard did it work today?',
    options: [
      ['barely', 'Barely'],
      ['solid', 'Solid work'],
      ['everything', 'Everything it had'],
    ],
  },
  {
    field: 'amount',
    label: 'How was the amount?',
    options: [
      ['could_take_more', 'Could take more'],
      ['right', 'Right'],
      ['stretch', 'A stretch'],
      ['over_the_line', 'Over the line'],
    ],
  },
]

type CheckinDraft = Partial<Record<'recovery' | 'effort' | 'amount', string>>

/** Full-screen session player: one exercise at a time, sets checked off. */
export default function Session({ session, plans, onExit }: Props) {
  const [sets, setSets] = useState<PlannedSet[]>([])
  const [lastTime, setLastTime] = useState<Map<string, PlannedSet[]>>(new Map())
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map())
  const [checkin, setCheckin] = useState<Map<string, CheckinDraft>>(new Map())
  const [cardioMin, setCardioMin] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('planned_sets')
      .select('*')
      .eq('session_id', session.id)
      .order('sort_order')
    setSets((data as PlannedSet[]) ?? [])
    setLoaded(true)
  }, [session.id])

  useEffect(() => {
    load()
    // a set logged via the composer or Telegram shows up live
    const channel = supabase
      .channel(`session-${session.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'planned_sets' }, load)
      .subscribe()
    // stamp the start date so NL logging knows this session is open today
    if (!session.date) {
      supabase.from('planned_sessions').update({ date: localDate() }).eq('id', session.id).then(() => {})
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onExit()
    window.addEventListener('keydown', onKey)
    return () => {
      supabase.removeChannel(channel)
      window.removeEventListener('keydown', onKey)
    }
  }, [load, session, onExit])

  // previous logged sets per exercise (for "last time" + placeholders)
  useEffect(() => {
    const exercises = [...new Set(sets.map((s) => s.exercise))]
    if (exercises.length === 0) return
    supabase
      .from('planned_sets')
      .select('*')
      .neq('session_id', session.id)
      .not('logged_at', 'is', null)
      .in('exercise', exercises)
      .order('logged_at', { ascending: false })
      .limit(60)
      .then(({ data }) => {
        const map = new Map<string, PlannedSet[]>()
        for (const row of (data as PlannedSet[]) ?? []) {
          // keep only the most recent session's sets per exercise
          const existing = map.get(row.exercise)
          if (!existing) map.set(row.exercise, [row])
          else if (existing[0].session_id === row.session_id) existing.push(row)
        }
        for (const list of map.values()) list.sort((a, b) => a.set_number - b.set_number)
        setLastTime(map)
      })
  }, [sets.length > 0, session.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const exercises = [...new Set(sets.map((s) => s.exercise))]
  const currentExercise = exercises.find((e) => sets.some((s) => s.exercise === e && !s.logged_at))
  const exerciseSets = sets.filter((s) => s.exercise === currentExercise)
  const handled = sets.filter((s) => s.logged_at).length
  const plan = plans.find((p) => p.exercise === currentExercise)
  const prev = currentExercise ? lastTime.get(currentExercise) : undefined

  function draftFor(set: PlannedSet): Draft {
    return drafts.get(set.id) ?? { weight: '', reps: '' }
  }

  function placeholderFor(set: PlannedSet): Draft {
    const prevSet = prev?.find((p) => p.set_number === set.set_number) ?? prev?.[prev.length - 1]
    return {
      weight: prevSet?.logged_weight != null ? String(prevSet.logged_weight) : '',
      reps: prevSet?.logged_reps != null ? String(prevSet.logged_reps) : '',
    }
  }

  async function toggleSet(set: PlannedSet) {
    if (set.logged_at) {
      // un-log: taps are always reversible
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, logged_at: null, logged_weight: null, logged_reps: null } : s)))
      await supabase
        .from('planned_sets')
        .update({ logged_at: null, logged_weight: null, logged_reps: null })
        .eq('id', set.id)
      await supabase.from('planned_sessions').update({ completed_at: null }).eq('id', session.id)
      return
    }
    const draft = draftFor(set)
    const ph = placeholderFor(set)
    const weight = parseFloat(draft.weight || ph.weight)
    const reps = parseInt(draft.reps || ph.reps, 10)
    const logged = {
      logged_weight: Number.isFinite(weight) ? weight : null,
      logged_reps: Number.isFinite(reps) ? reps : null,
      logged_at: new Date().toISOString(),
    }
    const after = sets.map((s) => (s.id === set.id ? { ...s, ...logged } : s))
    setSets(after)
    await supabase.from('planned_sets').update(logged).eq('id', set.id)
    if (after.every((s) => s.logged_at)) {
      await supabase.from('planned_sessions').update({ completed_at: new Date().toISOString() }).eq('id', session.id)
    }
  }

  async function saveAndClose() {
    if (saving) return
    setSaving(true)
    try {
      const rows = [...checkin.entries()]
        .filter(([, v]) => v.recovery || v.effort || v.amount)
        .map(([muscle_group, v]) => ({
          session_id: session.id,
          muscle_group,
          recovery: v.recovery ?? null,
          effort: v.effort ?? null,
          amount: v.amount ?? null,
        }))
      if (rows.length > 0) await supabase.from('recovery_checkins').insert(rows)
      const minutes = parseFloat(cardioMin)
      if (session.cardio && Number.isFinite(minutes) && minutes > 0) {
        await supabase.from('cardio_logs').insert({
          session_id: session.id,
          date: localDate(),
          kind: 'run',
          minutes,
          notes: session.cardio,
        })
      }
    } finally {
      onExit()
    }
  }

  async function skipExercise() {
    if (!currentExercise) return
    const toSkip = exerciseSets.filter((s) => !s.logged_at)
    const after = sets.map((s) =>
      toSkip.some((t) => t.id === s.id) ? { ...s, logged_at: new Date().toISOString() } : s,
    )
    setSets(after)
    await supabase
      .from('planned_sets')
      .update({ logged_at: new Date().toISOString() })
      .in('id', toSkip.map((s) => s.id))
    if (after.every((s) => s.logged_at)) {
      await supabase.from('planned_sessions').update({ completed_at: new Date().toISOString() }).eq('id', session.id)
    }
  }

  return (
    <div className="player session" role="dialog" aria-label={`${session.split_day} session`}>
      <div className="player-rail" aria-hidden="true">
        <div className="player-rail-fill" style={{ width: `${sets.length ? (handled / sets.length) * 100 : 0}%` }} />
      </div>
      <div className="player-inner">
        <div className="player-top">
          <span className="eyebrow">
            Week {session.week_number} · {session.split_day} · {handled}/{sets.length} sets
          </span>
          <button className="link" onClick={onExit}>
            exit
          </button>
        </div>

        {!loaded ? null : currentExercise ? (
          <div className="session-body" key={currentExercise}>
            <div className="session-exercise">
              {plan?.muscle_group && <span className="muscle-badge">{plan.muscle_group}</span>}
              <h2>{currentExercise}</h2>
              {exerciseSets[0]?.target_scheme && (
                <span className="session-target">{exerciseSets[0].target_scheme}</span>
              )}
              {plan?.safety_note && <p className="session-cue">🛡 {plan.safety_note}</p>}
              {prev && prev.length > 0 && (
                <p className="session-last">
                  last time: {prev.map((p) => `${p.logged_weight ?? '–'}×${p.logged_reps ?? '–'}`).join('  ')}
                </p>
              )}
            </div>
            <div className="set-rows">
              {exerciseSets.map((set) => {
                const done = !!set.logged_at
                const draft = draftFor(set)
                const ph = placeholderFor(set)
                return (
                  <div key={set.id} className={done ? 'set-row done' : 'set-row'}>
                    <span className="set-num">{set.set_number}</span>
                    {done ? (
                      <span className="set-logged">
                        {set.logged_weight != null || set.logged_reps != null
                          ? `${set.logged_weight ?? '–'} kg × ${set.logged_reps ?? '–'}`
                          : 'skipped'}
                      </span>
                    ) : (
                      <>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder={ph.weight || 'kg'}
                          value={draft.weight}
                          onChange={(e) => setDrafts(new Map(drafts).set(set.id, { ...draft, weight: e.target.value }))}
                        />
                        <span className="set-x">×</span>
                        <input
                          type="number"
                          inputMode="numeric"
                          placeholder={ph.reps || 'reps'}
                          value={draft.reps}
                          onChange={(e) => setDrafts(new Map(drafts).set(set.id, { ...draft, reps: e.target.value }))}
                        />
                      </>
                    )}
                    <button className={done ? 'set-check done' : 'set-check'} onClick={() => toggleSet(set)}>
                      ✓
                    </button>
                  </div>
                )
              })}
            </div>
            <button className="link session-skip" onClick={skipExercise}>
              skip this exercise
            </button>
          </div>
        ) : (
          (() => {
            const trained = [...new Set(sets.filter((s) => s.logged_reps != null).map((s) => s.muscle_group))].filter(
              Boolean,
            ) as string[]
            return (
              <div className="session-body checkin">
                <div className="checkin-head">
                  <span className="checkin-check">✓</span>
                  <h2>{session.split_day} done. Good work.</h2>
                  {(trained.length > 0 || session.cardio) && (
                    <p className="gentle">Quick check-in if you feel like it — skip is always fine.</p>
                  )}
                </div>

                {session.cardio && (
                  <div className="cardio-offer">
                    <span className="cardio-label">🏃 {session.cardio}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      placeholder="min"
                      value={cardioMin}
                      onChange={(e) => setCardioMin(e.target.value)}
                    />
                    <span className="gentle-inline">leave empty if it didn’t happen</span>
                  </div>
                )}

                {trained.map((muscle) => {
                  const draft = checkin.get(muscle) ?? {}
                  return (
                    <div key={muscle} className="checkin-muscle">
                      <span className="muscle-badge">{muscle}</span>
                      {CHECKIN_QUESTIONS.map((q) => (
                        <div key={q.field} className="checkin-q">
                          <span className="energy-label">{q.label}</span>
                          <div className="checkin-pills">
                            {q.options.map(([value, label]) => (
                              <button
                                key={value}
                                className={draft[q.field] === value ? 'energy-btn active' : 'energy-btn'}
                                onClick={() =>
                                  setCheckin(
                                    new Map(checkin).set(muscle, {
                                      ...draft,
                                      [q.field]: draft[q.field] === value ? undefined : value,
                                    }),
                                  )
                                }
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}

                <div className="player-buttons checkin-buttons">
                  <button className="player-done" onClick={saveAndClose} disabled={saving}>
                    {saving ? '…' : 'Save & close'}
                  </button>
                </div>
              </div>
            )
          })()
        )}
      </div>
    </div>
  )
}
