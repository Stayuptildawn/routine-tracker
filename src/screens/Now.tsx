import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { Energy, Reminder, Routine, Suggestion, TaskLog, Task, InterpretResponse } from '../lib/types'
import { interpretMessage, setTaskStatus, setReminderStatus, suggestNext, describeAction, undoAiAction } from '../lib/actions'
import type { NextSuggestion } from '../lib/actions'
import { describeDue, pendingOrder } from './Reminders'
import { consumeSharedText } from '../lib/shareTarget'
import { getNudgeState, enableNudges, disableNudges } from '../lib/push'
import Player from './Player'
import Skeleton from '../components/Skeleton'

const TIER_BY_ENERGY: Record<Energy, string[]> = {
  low: ['core'],
  medium: ['core', 'standard'],
  high: ['core', 'standard', 'bonus'],
}

interface UndoState {
  aiActionId: string
  response: InterpretResponse
}

// an anchored routine "activates" within this many minutes of its anchor_time
const ANCHOR_WINDOW = 120

function fmtEta(diff: number): string {
  const abs = Math.abs(diff)
  const t = abs >= 60 ? `${Math.floor(abs / 60)}h ${String(abs % 60).padStart(2, '0')}m` : `${abs} min`
  return diff > 0 ? `in ${t}` : diff < 0 ? `${t} ago` : 'now'
}

export default function Now({ onOpenReminders }: { onOpenReminders: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [logs, setLogs] = useState<Map<string, TaskLog>>(new Map())
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [loaded, setLoaded] = useState(false)
  // text shared into the PWA prefills the composer - reviewed, never auto-sent
  const [message, setMessage] = useState(() => consumeSharedText() ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [undo, setUndo] = useState<UndoState | null>(null)
  const [playing, setPlaying] = useState<{ routineId: string; focusTaskId?: string | null } | null>(null)
  const [next, setNext] = useState<NextSuggestion | null>(null)
  const [nextBusy, setNextBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [nudges, setNudges] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown')
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const today = localDate()
  const weekday = isoWeekday()

  // minute tick keeps anchor sort + countdown ring honest (time blindness aid)
  useEffect(() => {
    const t = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 60_000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    getNudgeState().then(setNudges)
  }, [])

  const load = useCallback(async () => {
    const [routinesRes, logsRes, stateRes, remindersRes] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, category, sort_order, anchor_time, tasks(id, routine_id, label, sort_order, scheduled_days, tier)')
        .order('sort_order'),
      supabase.from('task_logs').select('*').eq('date', today),
      supabase.from('daily_state').select('energy').eq('date', today).maybeSingle(),
      supabase.from('reminders').select('*').in('status', ['auto', 'reassigned']),
    ])
    setRoutines((routinesRes.data as Routine[]) ?? [])
    setLogs(new Map(((logsRes.data as TaskLog[]) ?? []).map((l) => [l.task_id, l])))
    setEnergy((stateRes.data?.energy as Energy) ?? null)
    setReminders(((remindersRes.data as Reminder[]) ?? []).sort(pendingOrder))
    setLoaded(true)
  }, [today])

  useEffect(() => {
    load()
    const channel = supabase
      .channel('now-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_logs' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_state' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, load)
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  async function pickEnergy(level: Energy) {
    setEnergy(level)
    await supabase.from('daily_state').upsert({ date: today, energy: level }, { onConflict: 'user_id,date' })
  }

  async function clearReminder(r: Reminder) {
    setReminders((prev) => prev.filter((x) => x.id !== r.id))
    await setReminderStatus(r.id, 'done')
  }

  async function tapStatus(task: Task, status: 'done' | 'skipped') {
    const current = logs.get(task.id)?.status
    const next = current === status ? 'pending' : status // tap again to un-set
    // optimistic: the tap lands instantly, online or not
    setLogs((prev) => {
      const map = new Map(prev)
      const existing = prev.get(task.id)
      map.set(task.id, {
        ...(existing ?? { id: '', task_id: task.id, date: today, completed_via: 'manual', notes: null }),
        status: next,
      })
      return map
    })
    // when queued offline, keep the optimistic state - a reload would revert it
    if ((await setTaskStatus(task.id, next)) === 'saved') load()
  }

  async function send() {
    const text = message.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await interpretMessage(text)
      if (result === 'queued') {
        setNotice('Offline — saved, will send when back online.')
      } else if (result.error) {
        setNotice(`Something went wrong: ${result.error}`)
      } else {
        setMessage('')
        setSuggestions(result.suggestions)
        if (result.answers && result.answers.length > 0) {
          setNotice(result.answers.join('\n'))
        }
        if (result.applied.length > 0 && result.ai_action_id) {
          setUndo({ aiActionId: result.ai_action_id, response: result })
        } else if (result.applied.length === 0 && result.suggestions.length === 0 && !result.answers?.length) {
          setNotice('Nothing matched — try naming the task, or add it as a reminder.')
        }
        load()
      }
    } catch (err) {
      setNotice(`Couldn't reach the AI: ${String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function confirmSuggestion(s: Suggestion) {
    await setTaskStatus(s.task_id, s.status, 'ai_text')
    setSuggestions((prev) => prev.filter((x) => x.task_id !== s.task_id))
    load()
  }

  async function askNext() {
    if (nextBusy) return
    setNextBusy(true)
    setNotice(null)
    try {
      const s = await suggestNext()
      if (s.error) setNotice(`Something went wrong: ${s.error}`)
      else if (!s.task_id) setNotice('Nothing pending — you’re free.')
      else setNext(s)
    } catch (err) {
      setNotice(`Couldn't reach the AI: ${String(err)}`)
    } finally {
      setNextBusy(false)
    }
  }

  function openNext() {
    if (!next?.task_id) return
    const section = sections.find((s) => s.tasks.some((t) => t.id === next.task_id))
    if (section) setPlaying({ routineId: section.routine.id, focusTaskId: next.task_id })
    setNext(null)
  }

  async function runUndo() {
    if (!undo) return
    await undoAiAction(undo.aiActionId, undo.response.applied)
    setUndo(null)
    load()
  }

  function startVoice() {
    const SpeechRecognition =
      (window as unknown as Record<string, unknown>).SpeechRecognition ??
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition
    if (!SpeechRecognition) {
      setNotice('Voice input is not supported in this browser.')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SpeechRecognition as any)()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.onresult = (e: { results: { transcript: string }[][] }) => {
      setMessage((prev) => (prev ? prev + ' ' : '') + e.results[0][0].transcript)
    }
    rec.onend = () => setListening(false)
    recognitionRef.current = rec
    setListening(true)
    rec.start()
  }

  const visibleTiers = TIER_BY_ENERGY[energy ?? 'medium']
  const sections = routines
    .map((r) => ({
      routine: r,
      tasks: (r.tasks ?? [])
        .filter((t) => t.scheduled_days.includes(weekday) && visibleTiers.includes(t.tier))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
    .filter((s) => s.tasks.length > 0)
    .map((s) => {
      const doneCount = s.tasks.filter((t) => {
        const status = logs.get(t.id)?.status
        return status === 'done' || status === 'skipped' || status === 'partial'
      }).length
      // signed minutes until (+) / since (-) the anchor, if any
      let anchorDiff: number | null = null
      if (s.routine.anchor_time) {
        const [h, m] = s.routine.anchor_time.split(':').map(Number)
        anchorDiff = h * 60 + m - nowMin
      }
      return { ...s, doneCount, complete: doneCount === s.tasks.length, anchorDiff }
    })
    // finished routines sink; anchored routines near their time float up;
    // everything else keeps sort_order (stable sort)
    .sort((a, b) => {
      if (a.complete !== b.complete) return Number(a.complete) - Number(b.complete)
      const near = (d: number | null) => (d !== null && Math.abs(d) <= ANCHOR_WINDOW ? Math.abs(d) : Infinity)
      return near(a.anchorDiff) - near(b.anchorDiff)
    })

  const activeAnchorId = sections.find(
    (s) => !s.complete && s.anchorDiff !== null && Math.abs(s.anchorDiff) <= ANCHOR_WINDOW,
  )?.routine.id

  return (
    <div className="now">
      <p className="eyebrow">
        {new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
      </p>
      <div className="composer">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder='Just tell me… "took my meds and drank water"'
          rows={2}
        />
        <div className="composer-buttons">
          <button
            className={listening ? 'voice listening' : 'voice'}
            onClick={() => (listening ? recognitionRef.current?.stop() : startVoice())}
            title="Voice input"
          >
            🎤
          </button>
          <button className="send" onClick={send} disabled={busy || !message.trim()}>
            {busy ? '…' : 'Send'}
          </button>
        </div>
      </div>

      {notice && <div className="notice">{notice}</div>}

      {suggestions.length > 0 && (
        <div className="chips">
          <span className="chips-label">Did you mean:</span>
          {suggestions.map((s) => (
            <button key={s.task_id} className="chip" onClick={() => confirmSuggestion(s)}>
              {s.status === 'skipped' ? '⏭' : '✓'} {s.label}
            </button>
          ))}
          <button className="chip dismiss" onClick={() => setSuggestions([])}>
            ✕ No
          </button>
        </div>
      )}

      <div className="energy-row">
        <span className="energy-label">Energy today</span>
        {(['low', 'medium', 'high'] as Energy[]).map((level) => (
          <button
            key={level}
            className={energy === level ? 'energy-btn active' : 'energy-btn'}
            onClick={() => pickEnergy(level)}
          >
            {level === 'low' ? '🪫 Low' : level === 'medium' ? '🔋 Medium' : '⚡ High'}
          </button>
        ))}
      </div>
      {energy === 'low' && (
        <p className="gentle">Low-energy mode: only the essentials. Doing these counts as a full win.</p>
      )}

      {loaded && sections.some((s) => !s.complete) && (
        <div className="next-row">
          {next?.task_id ? (
            <>
              <button className="chip" onClick={openNext}>
                Next: {next.label} — {next.reason}
              </button>
              <button className="chip dismiss" onClick={() => setNext(null)}>
                ✕
              </button>
            </>
          ) : (
            <button className="next-btn" onClick={askNext} disabled={nextBusy}>
              {nextBusy ? 'Thinking…' : '✨ What’s next?'}
            </button>
          )}
        </div>
      )}

      {loaded && (
        <section className="routine reminders-card">
          <h2>
            Reminders
            {reminders.length > 0 && <span className="routine-progress">{reminders.length}</span>}
          </h2>
          {reminders.slice(0, 4).map((r) => {
            const due = r.due_date ? describeDue(r.due_date, today) : null
            return (
              <div key={r.id} className="task">
                <span className="task-label">
                  {r.raw_text}
                  {due && (
                    <span className={due.overdue ? 'due-pill overdue' : 'due-pill'}>
                      {due.overdue ? '⏳ ' : '📆 '}
                      {due.label}
                    </span>
                  )}
                </span>
                <div className="task-buttons">
                  <button className="do" onClick={() => clearReminder(r)}>
                    Done
                  </button>
                </div>
              </div>
            )
          })}
          {reminders.length === 0 && (
            <p className="gentle reminders-empty">Nothing on hold. Say “remind me to…” and it lands here.</p>
          )}
          <button className="link see-all" onClick={onOpenReminders}>
            {reminders.length > 4 ? `See all ${reminders.length} →` : 'Open reminders →'}
          </button>
        </section>
      )}

      {!loaded ? (
        <Skeleton cards={3} />
      ) : (
        <div className="routine-list">
          {sections.map(({ routine, tasks, doneCount, complete: allHandled, anchorDiff }) => {
            const showRing = routine.id === activeAnchorId && anchorDiff !== null
            const ringPct = showRing ? Math.round(((ANCHOR_WINDOW - Math.min(Math.abs(anchorDiff), ANCHOR_WINDOW)) / ANCHOR_WINDOW) * 100) : 0
            return (
              <section key={routine.id} className={allHandled ? 'routine complete' : 'routine'}>
                <div className="rail" aria-hidden="true">
                  <div
                    className="rail-fill"
                    style={{ height: `${(doneCount / tasks.length) * 100}%` }}
                  />
                </div>
                <h2>
                  {routine.name}
                  <span className="routine-progress">
                    {allHandled ? ' ✓' : ` ${doneCount}/${tasks.length}`}
                  </span>
                  {showRing && (
                    <span className="anchor-chip" title={`anchored around ${routine.anchor_time?.slice(0, 5)}`}>
                      <span
                        className="anchor-ring"
                        style={{ background: `conic-gradient(var(--accent) ${ringPct}%, var(--surface-3) 0)` }}
                        aria-hidden="true"
                      />
                      {fmtEta(anchorDiff!)}
                    </span>
                  )}
                  {!allHandled && (
                    <button
                      className="start-btn"
                      onClick={() => setPlaying({ routineId: routine.id })}
                      title="One task at a time"
                    >
                      ▶ Start
                    </button>
                  )}
                </h2>
                {!allHandled &&
                  tasks.map((task) => {
                    const status = logs.get(task.id)?.status ?? 'pending'
                    return (
                      <div key={task.id} className={`task ${status}`}>
                        <span className="task-label">{task.label}</span>
                        <div className="task-buttons">
                          <button
                            className={status === 'done' ? 'do active' : 'do'}
                            onClick={() => tapStatus(task, 'done')}
                          >
                            Done
                          </button>
                          <button
                            className={status === 'skipped' ? 'skip active' : 'skip'}
                            onClick={() => tapStatus(task, 'skipped')}
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    )
                  })}
              </section>
            )
          })}
        </div>
      )}

      {loaded && sections.length === 0 && (
        <p className="gentle">Nothing scheduled right now. That’s allowed.</p>
      )}

      {loaded && (nudges === 'on' || nudges === 'off') && (
        <p className="gentle nudge-row">
          {nudges === 'on' ? (
            <>
              🔔 Nudges on
              <button
                className="link"
                onClick={async () => {
                  await disableNudges()
                  setNudges('off')
                }}
              >
                turn off
              </button>
            </>
          ) : (
            <button
              className="link"
              onClick={async () => {
                const result = await enableNudges()
                if (result === 'on') setNudges('on')
                else if (result === 'denied')
                  setNotice('Notifications are blocked for this site — enable them in browser settings first.')
              }}
            >
              🔔 Enable gentle nudges
            </button>
          )}
        </p>
      )}

      {playing &&
        (() => {
          const s = sections.find((x) => x.routine.id === playing.routineId)
          if (!s) return null
          return (
            <Player
              routineName={s.routine.name}
              tasks={s.tasks}
              logs={logs}
              focusTaskId={playing.focusTaskId}
              onStatus={tapStatus}
              onExit={() => setPlaying(null)}
            />
          )
        })()}

      {undo && (
        <div className="toast">
          <div className="toast-lines">
            {undo.response.applied.map((a, i) => (
              <div key={i}>{describeAction(a)}</div>
            ))}
          </div>
          <button onClick={runUndo}>Undo</button>
          <button className="toast-close" onClick={() => setUndo(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
