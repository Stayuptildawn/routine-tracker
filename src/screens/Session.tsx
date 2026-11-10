import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { runOp } from '../lib/offline'
import { localDate } from '../lib/types'
import type { PlannedSession, PlannedSet, WorkoutLog, WorkoutPlan } from '../lib/types'
import { t, locale } from '../i18n'
import Icon from '../components/Icon'
import { Button, Chips, IconButton, Sheet, cx } from '../components/ui'

interface Props {
  session: PlannedSession
  plans: WorkoutPlan[] // for neck cues
  onExit: () => void
  /** true while the exit transition plays (usePresence in the parent) */
  closing?: boolean
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
const CHECKIN_FIELDS: ('recovery' | 'effort' | 'amount')[] = ['recovery', 'effort', 'amount']

type CheckinDraft = Partial<Record<'recovery' | 'effort' | 'amount', string>>

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

const muscleLabel = (m: string) => t.muscles[m] ?? m

/** Card-corner target, rebuilt from the rows that actually exist: recovery
 *  tweaks (±1 set at block start) and mid-block plan edits change row counts,
 *  so the written scheme's set number can lie - the rep range never does. */
function displayTarget(exSets: PlannedSet[]): string {
  const scheme = exSets.find((s) => s.target_scheme)?.target_scheme
  if (!scheme) return ''
  const m = scheme.match(/^\s*\d+\s*[x×]\s*(.*)$/i)
  return m ? `${exSets.length} x ${m[1]}`.trim() : scheme
}

/** "Jul 4, 2026" from a yyyy-mm-dd string. */
const fmtDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })

/** Full-screen day view: every exercise with its set rows, RP-style overview. */
export default function Session({ session, plans, onExit, closing }: Props) {
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
    // a set logged via the composer shows up live
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
      toSkip.some((x) => x.id === s.id) ? { ...s, logged_at: new Date().toISOString() } : s,
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
    <Sheet
      title={t.session.header(session.week_number, session.split_day, handled, sets.length)}
      label={t.session.aria(session.split_day)}
      onClose={() => leaveRef.current()}
      closeLabel={t.session.exit}
      closing={closing}
      progress={sets.length ? handled / sets.length : 0}
    >
      <div className="sheet__body">
        <div className="field field--inline">
          <span className="field__label">
            <Icon name="calendar" /> {t.session.workoutDate}
          </span>
          {handled > 0 ? (
            <input
              type="date"
              value={sessionDate}
              aria-label={t.session.workoutDate}
              onChange={(e) => updateSessionDate(e.target.value)}
            />
          ) : (
            <strong>{fmtDate(localDate())}</strong>
          )}
        </div>

        {/* the grey numbers are last time's, and the tick logs them as-is -
            obvious once you know, invisible on a first session */}
        {loaded && handled === 0 && lastTime.size > 0 && <p className="hint">{t.session.placeholderHint}</p>}

        {!loaded ? null : !allDone || reviewing ? (
          <>
            {allDone && reviewing && (
              <Button variant="ghost" className="session__back" onClick={() => setReviewing(false)}>
                {t.session.doneEditingBack}
              </Button>
            )}
            {exercises.map((exercise) => {
              const exSets = sets.filter((s) => s.exercise === exercise)
              const plan = plans.find((p) => p.exercise === exercise)
              const prev = lastTime.get(exercise)
              const exDone = exSets.every((s) => s.logged_at)
              const isCurrent = exercise === currentExercise
              const muscle = exSets[0]?.muscle_group ?? plan?.muscle_group
              // an injury report's cue outranks the plan's own safety note
              const injuryNote = exSets.find((s) => s.injury_note && !s.logged_at)?.injury_note
              return (
                <section key={exercise} className={cx('card exercise', exDone && 'exercise--done', isCurrent && 'exercise--current')}>
                  <div className="card__head">
                    {muscle ? <span className="badge badge--caps">{muscleLabel(muscle)}</span> : <span />}
                    <span className="exercise__target">{displayTarget(exSets)}</span>
                  </div>
                  <h2>{exercise}</h2>
                  {injuryNote && (
                    <p className="cue cue--injury">
                      <Icon name="shield" /> {injuryNote}
                    </p>
                  )}
                  {plan?.safety_note && !exDone && (
                    <p className="cue">
                      <Icon name="shield" /> {plan.safety_note}
                    </p>
                  )}
                  {prev && prev.length > 0 && !exDone && (
                    <p className="mono hint">{t.session.lastTime(prev.map((p) => `${p.weight ?? '–'}×${p.reps ?? '–'}`).join('  '))}</p>
                  )}
                  <div className="stack stack--tight">
                    {exSets.map((set) => {
                      const done = !!set.logged_at
                      const draft = draftFor(set)
                      const ph = placeholderFor(set)
                      return (
                        <div key={set.id} className="set-row">
                          <span className="set-row__num">{set.set_number}</span>
                          {done ? (
                            <span className="set-row__logged mono">
                              {set.logged_weight != null || set.logged_reps != null
                                ? t.session.kgReps(String(set.logged_weight ?? '–'), String(set.logged_reps ?? '–'))
                                : t.session.skipped}
                            </span>
                          ) : (
                            <>
                              <input
                                className="input--num"
                                type="number"
                                inputMode="decimal"
                                aria-label={t.session.kgPh}
                                placeholder={ph.weight || t.session.kgPh}
                                value={draft.weight}
                                onChange={(e) => setDrafts(new Map(drafts).set(set.id, { ...draft, weight: e.target.value }))}
                              />
                              <span className="hint">×</span>
                              <input
                                className="input--num"
                                type="number"
                                inputMode="numeric"
                                aria-label={t.session.repsPh}
                                placeholder={ph.reps || t.session.repsPh}
                                value={draft.reps}
                                onChange={(e) => setDrafts(new Map(drafts).set(set.id, { ...draft, reps: e.target.value }))}
                              />
                            </>
                          )}
                          <IconButton
                            icon={done ? 'pencil' : 'check'}
                            variant={done ? 'plain' : 'filled'}
                            className="push-end"
                            label={done ? t.session.editSet : t.session.logSet}
                            onClick={() => toggleSet(set)}
                          />
                        </div>
                      )
                    })}
                  </div>
                  {!exDone && (
                    <Button variant="ghost" size="sm" className="session__skip" onClick={() => skipExercise(exercise)}>
                      {t.session.skipExercise}
                    </Button>
                  )}
                </section>
              )
            })}
          </>
        ) : (
          (() => {
            const trained = [...new Set(sets.filter((s) => s.logged_reps != null).map((s) => s.muscle_group))].filter(
              Boolean,
            ) as string[]
            return (
              <>
                <div className="checkin__head">
                  <span className="checkin__check">
                    <Icon name="check" />
                  </span>
                  <h2>{t.session.doneGoodWork(session.split_day)}</h2>
                  {trained.length > 0 && <p className="hint">{hadSaved ? t.session.earlierAnswers : t.session.quickCheckin}</p>}
                </div>

                {trained.map((muscle) => {
                  const draft = checkin.get(muscle) ?? {}
                  return (
                    <section key={muscle} className="card">
                      <span className="badge badge--caps checkin__muscle">{muscleLabel(muscle)}</span>
                      {CHECKIN_FIELDS.map((field) => (
                        <div key={field} className="field">
                          <span className="field__label">{t.session.questions[field].label}</span>
                          <Chips
                            label={t.session.questions[field].label}
                            value={draft[field] ?? null}
                            // a second tap on the chosen answer clears it
                            onChange={(value) =>
                              setCheckin(new Map(checkin).set(muscle, { ...draft, [field]: draft[field] === value ? undefined : value }))
                            }
                            options={Object.entries(t.session.questions[field].options).map(([value, label]) => ({ value, label }))}
                          />
                        </div>
                      ))}
                    </section>
                  )
                })}

                <Button variant="primary" size="lg" block busy={saving} onClick={saveAndClose}>
                  {t.session.saveClose}
                </Button>
                <Button variant="ghost" icon="pencil" className="session__edit" onClick={() => setReviewing(true)}>
                  {t.session.editLoggedSet}
                </Button>
              </>
            )
          })()
        )}
      </div>
    </Sheet>
  )
}
