import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOverlay } from '../lib/overlay'
import { runOp } from '../lib/offline'
import { localDate } from '../lib/types'
import type { PlannedSession, PlannedSet, WorkoutLog, WorkoutPlan } from '../lib/types'

interface Props {
  session: PlannedSession
  plans: WorkoutPlan[] // for neck cues
  onExit: () => void
}

interface Draft {
  weight: string
  reps: string
}

interface PrevSet {
  set_number: number
  weight: number | null
  reps: number | null
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

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** "Jul 4, 2026" from a yyyy-mm-dd string. */
const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** Full-screen day view: every exercise with its set rows, RP-style overview. */
export default function Session({ session, plans, onExit }: Props) {
  const [sets, setSets] = useState<PlannedSet[]>([])
  const [lastTime, setLastTime] = useState<Map<string, PrevSet[]>>(new Map())
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map())
  const [checkin, setCheckin] = useState<Map<string, CheckinDraft>>(new Map())
  const [hadSaved, setHadSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // when the session is already complete, lets the user reopen the set list to
  // edit a logged set instead of being stuck on the finish screen
  const [reviewing, setReviewing] = useState(false)
  // the day this workout was actually done — editable, since logging is often
  // retroactive. The Explore chart dates strength sets by this, not save-time.
  const [sessionDate, setSessionDate] = useState<string>(session.date ?? localDate())

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
    // earlier check-in answers come back, so a reopened session never looks
    // unlogged (and saves update, not duplicate)
    supabase
      .from('recovery_checkins')
      .select('muscle_group, recovery, effort, amount')
      .eq('session_id', session.id)
      .then(({ data }) => {
        if (!data || data.length === 0) return
        const map = new Map<string, CheckinDraft>()
        for (const row of data) {
          map.set(row.muscle_group, {
            recovery: row.recovery ?? undefined,
            effort: row.effort ?? undefined,
            amount: row.amount ?? undefined,
          })
        }
        setCheckin(map)
        setHadSaved(true)
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load, session])

  // previous numbers per exercise: planned sets from earlier sessions first,
  // the old freeform workout_logs as fallback (pre-block history counts)
  useEffect(() => {
    const exercises = [...new Set(sets.map((s) => s.exercise))]
    if (exercises.length === 0) return
    Promise.all([
      supabase
        .from('planned_sets')
        .select('exercise, session_id, set_number, logged_weight, logged_reps, logged_at')
        .neq('session_id', session.id)
        .not('logged_at', 'is', null)
        .not('logged_reps', 'is', null)
        .in('exercise', exercises)
        .order('logged_at', { ascending: false })
        .limit(60),
      supabase.from('workout_logs').select('exercise, sets, date').order('date', { ascending: false }).limit(100),
    ]).then(([plannedRes, legacyRes]) => {
      const map = new Map<string, PrevSet[]>()
      const bySession = new Map<string, string>()
      for (const row of plannedRes.data ?? []) {
        // keep only the most recent session's sets per exercise
        const keeper = bySession.get(row.exercise)
        if (keeper && keeper !== row.session_id) continue
        bySession.set(row.exercise, row.session_id)
        const list = map.get(row.exercise) ?? []
        list.push({ set_number: row.set_number, weight: row.logged_weight, reps: row.logged_reps })
        map.set(row.exercise, list)
      }
      for (const list of map.values()) list.sort((a, b) => a.set_number - b.set_number)
      // legacy fallback for exercises never logged in a block
      for (const ex of exercises) {
        if (map.has(ex)) continue
        const legacy = (legacyRes.data as WorkoutLog[] | null)?.find(
          (l) => l.sets && (norm(l.exercise).includes(norm(ex)) || norm(ex).includes(norm(l.exercise))),
        )
        if (legacy?.sets) {
          map.set(
            ex,
            legacy.sets.map((s, i) => ({ set_number: i + 1, weight: s.kg, reps: s.reps })),
          )
        }
      }
      setLastTime(map)
    })
  }, [sets.length > 0, session.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // An empty session (nothing logged yet) is always "today" — restamp it so a
  // fresh workout is dated the day it's actually done, not the day the card was
  // first opened, and so NL logging (which routes by date = today) targets it.
  // Once it has logged sets its date is real and stays put (editable).
  useEffect(() => {
    if (!loaded || sets.some((s) => s.logged_at)) return
    const today = localDate()
    if (session.date !== today) {
      setSessionDate(today)
      runOp({ table: 'planned_sessions', op: 'update', ids: [session.id], values: { date: today } }).catch(() => {})
    }
  }, [loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  // this player is a fixed full-screen overlay; lock the page behind it so
  // there's only one scrollbar (the set list), not the page's as well.
  useEffect(() => {
    const html = document.documentElement
    const prev = html.style.overflow
    html.style.overflow = 'hidden'
    return () => {
      html.style.overflow = prev
    }
  }, [])

  function updateSessionDate(d: string) {
    if (!d) return
    setSessionDate(d)
    runOp({ table: 'planned_sessions', op: 'update', ids: [session.id], values: { date: d } }).catch(() => {})
  }

  const exercises = [...new Set(sets.map((s) => s.exercise))]
  const handled = sets.filter((s) => s.logged_at).length
  const allDone = loaded && sets.length > 0 && handled === sets.length
  const currentExercise = exercises.find((e) => sets.some((s) => s.exercise === e && !s.logged_at))

  // leaving a finished session saves the check-in - exit must never lose data.
  // Escape and the installed-PWA back button leave the same safe way.
  const leaveRef = useRef<() => void>(onExit)
  leaveRef.current = allDone ? saveAndClose : onExit
  const trapRef = useOverlay<HTMLDivElement>(() => leaveRef.current())

  function draftFor(set: PlannedSet): Draft {
    return drafts.get(set.id) ?? { weight: '', reps: '' }
  }

  function placeholderFor(set: PlannedSet): Draft {
    const prev = lastTime.get(set.exercise)
    const prevSet = prev?.find((p) => p.set_number === set.set_number) ?? prev?.[prev.length - 1]
    return {
      weight: prevSet?.weight != null ? String(prevSet.weight) : '',
      reps: prevSet?.reps != null ? String(prevSet.reps) : '',
    }
  }

  async function markComplete(after: PlannedSet[]) {
    if (after.every((s) => s.logged_at)) {
      await runOp({ table: 'planned_sessions', op: 'update', ids: [session.id], values: { completed_at: new Date().toISOString() } })
    }
  }

  async function toggleSet(set: PlannedSet) {
    if (set.logged_at) {
      // un-log: taps are always reversible
      setSets((prev) => prev.map((s) => (s.id === set.id ? { ...s, logged_at: null, logged_weight: null, logged_reps: null } : s)))
      await runOp({
        table: 'planned_sets',
        op: 'update',
        ids: [set.id],
        values: { logged_at: null, logged_weight: null, logged_reps: null },
      })
      await runOp({ table: 'planned_sessions', op: 'update', ids: [session.id], values: { completed_at: null } })
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
    await runOp({ table: 'planned_sets', op: 'update', ids: [set.id], values: logged })
    await markComplete(after)
  }

  async function skipExercise(exercise: string) {
    const toSkip = sets.filter((s) => s.exercise === exercise && !s.logged_at)
    if (toSkip.length === 0) return
    const after = sets.map((s) =>
      toSkip.some((t) => t.id === s.id) ? { ...s, logged_at: new Date().toISOString() } : s,
    )
    setSets(after)
    await runOp({
      table: 'planned_sets',
      op: 'update',
      ids: toSkip.map((s) => s.id),
      values: { logged_at: new Date().toISOString() },
    })
    await markComplete(after)
  }

  function saveAndClose() {
    if (saving) return
    setSaving(true)
    const rows = [...checkin.entries()]
      .filter(([, v]) => v.recovery || v.effort || v.amount)
      .map(([muscle_group, v]) => ({
        session_id: session.id,
        muscle_group,
        recovery: v.recovery ?? null,
        effort: v.effort ?? null,
        amount: v.amount ?? null,
      }))
    // exit NOW - waiting on the network here made the iOS back gesture feel
    // stuck for seconds. runOp queues offline, so the check-in still lands.
    onExit()
    void (async () => {
      // replace this session's answers wholesale - never duplicate
      await runOp({ table: 'recovery_checkins', op: 'delete', match: { session_id: session.id } })
      if (rows.length > 0) await runOp({ table: 'recovery_checkins', op: 'insert', values: rows })
    })()
  }

  return (
    <div ref={trapRef} className="player session" role="dialog" aria-modal="true" aria-label={`${session.split_day} session`}>
      <div className="player-rail" aria-hidden="true">
        <div className="player-rail-fill" style={{ width: `${sets.length ? (handled / sets.length) * 100 : 0}%` }} />
      </div>
      <div className="player-inner">
        <div className="player-top">
          <span className="eyebrow">
            Week {session.week_number} · {session.split_day} · {handled}/{sets.length} sets
          </span>
          <button className="link" onClick={() => leaveRef.current()}>
            exit
          </button>
        </div>

        <div className="session-date">
          <span>📅 Workout date</span>
          {handled > 0 ? (
            <input type="date" value={sessionDate} onChange={(e) => updateSessionDate(e.target.value)} />
          ) : (
            <span className="session-date-today">{fmtDate(localDate())}</span>
          )}
        </div>

        {!loaded ? null : !allDone || reviewing ? (
          <div className="session-list">
            {allDone && reviewing && (
              <button className="link session-review-back" onClick={() => setReviewing(false)}>
                ← done editing, back to finish
              </button>
            )}
            {exercises.map((exercise) => {
              const exSets = sets.filter((s) => s.exercise === exercise)
              const plan = plans.find((p) => p.exercise === exercise)
              const prev = lastTime.get(exercise)
              const exDone = exSets.every((s) => s.logged_at)
              const isCurrent = exercise === currentExercise
              const muscle = exSets[0]?.muscle_group ?? plan?.muscle_group
              return (
                <div key={exercise} className={`exercise-card${exDone ? ' done' : ''}${isCurrent ? ' current' : ''}`}>
                  <div className="exercise-head">
                    {muscle && <span className="muscle-badge">{muscle}</span>}
                    <span className="session-target">{exSets[0]?.target_scheme ?? ''}</span>
                  </div>
                  <h2>{exercise}</h2>
                  {plan?.safety_note && !exDone && <p className="session-cue">🛡 {plan.safety_note}</p>}
                  {prev && prev.length > 0 && !exDone && (
                    <p className="session-last">
                      last time: {prev.map((p) => `${p.weight ?? '–'}×${p.reps ?? '–'}`).join('  ')}
                    </p>
                  )}
                  <div className="set-rows">
                    {exSets.map((set) => {
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
                                onChange={(e) =>
                                  setDrafts(new Map(drafts).set(set.id, { ...draft, weight: e.target.value }))
                                }
                              />
                              <span className="set-x">×</span>
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder={ph.reps || 'reps'}
                                value={draft.reps}
                                onChange={(e) =>
                                  setDrafts(new Map(drafts).set(set.id, { ...draft, reps: e.target.value }))
                                }
                              />
                            </>
                          )}
                          <button
                            className={done ? 'set-check done' : 'set-check'}
                            onClick={() => toggleSet(set)}
                            aria-label={done ? 'Edit set' : 'Log set'}
                            title={done ? 'Edit set' : 'Log set'}
                          >
                            {done ? '✏️' : '✓'}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                  {!exDone && (
                    <button className="link session-skip" onClick={() => skipExercise(exercise)}>
                      skip this exercise
                    </button>
                  )}
                </div>
              )
            })}
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
                  {trained.length > 0 && (
                    <p className="gentle">
                      {hadSaved
                        ? 'Your earlier answers are loaded — edit freely, leaving saves.'
                        : 'Quick check-in if you feel like it — skip is always fine.'}
                    </p>
                  )}
                </div>

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
                  <button className="link" onClick={() => setReviewing(true)}>
                    ✏️ Edit a logged set
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
