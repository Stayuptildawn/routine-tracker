import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { localDate, isoWeekday } from '../lib/types'
import type { Energy, Reminder, Routine, Suggestion, TaskLog, Task, InterpretResponse } from '../lib/types'
import { AiLimitError, interpretMessage, pendingTaps, setTaskStatus, setReminderStatus, describeAction, undoAiAction } from '../lib/actions'
import { describeDue, pendingOrder, shortTime } from './Reminders'
import { consumeSharedText } from '../lib/shareTarget'
import { getNudgeState, enableNudges } from '../lib/push'
import { usePresence } from '../lib/overlay'
import { t, locale } from '../i18n'
import Player from './Player'
import Skeleton from '../components/Skeleton'
import Icon from '../components/Icon'
import { Button, Card, Dialog, EmptyState, ErrorState, IconButton, ListRow, Notice, ProgressBar, ScreenHeader, Segmented, cx } from '../components/ui'
import type { ChoiceOption } from '../components/ui'
import { MAX_LEN } from '../lib/limits'

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
  const dur =
    abs >= 60 ? t.now.hoursMinutes(Math.floor(abs / 60), String(abs % 60).padStart(2, '0')) : t.now.minutes(abs)
  return diff > 0 ? t.now.etaIn(dur) : diff < 0 ? t.now.etaAgo(dur) : t.now.etaNow
}

interface AnswerState {
  question: string
  lines: string[]
}

/** The reply to a question typed in the composer. A dialog, not the inline
 *  notice: answers can run a few sentences and deserve the focus. The same
 *  reply is already in the AI log (the server logs it) - the footer says so. */
function AnswerSheet({
  answer,
  onClose,
  onOpenLog,
  closing,
}: {
  answer: AnswerState
  onClose: () => void
  onOpenLog: () => void
  closing?: boolean
}) {
  return (
    <Dialog
      title={
        <>
          <Icon name="message" /> {t.now.answerTitle}
        </>
      }
      onClose={onClose}
      closing={closing}
      className="selectable"
    >
      <p className="hint answer__question">“{answer.question}”</p>
      {answer.lines.map((line, i) => (
        <p key={i} className="answer__text">
          {line}
        </p>
      ))}
      <div className="actions">
        <span className="hint">{t.now.answerSaved}</span>
        <Button variant="ghost" size="sm" onClick={onOpenLog}>
          {t.now.openLog}
        </Button>
        <Button variant="primary" className="push-end" onClick={onClose}>
          {t.common.close}
        </Button>
      </div>
    </Dialog>
  )
}

interface NoticeState {
  tone: 'info' | 'warn' | 'error'
  text: string
}

const ENERGY_OPTIONS: ChoiceOption<Energy>[] = [
  { value: 'low', label: t.now.energyLow, icon: 'battery-low' },
  { value: 'medium', label: t.now.energyMedium, icon: 'battery-medium' },
  { value: 'high', label: t.now.energyHigh, icon: 'zap' },
]

// the offer to switch nudges on shows once; after that it lives in Settings
const NUDGE_PROMPT_KEY = 'nudge-prompt-dismissed'

export default function Now({
  visible,
  onOpenReminders,
  onOpenSettings,
  onOpenLog,
}: {
  visible: boolean
  onOpenReminders: () => void
  onOpenSettings: () => void
  onOpenLog: () => void
}) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [logs, setLogs] = useState<Map<string, TaskLog>>(new Map())
  const [reminders, setReminders] = useState<Reminder[]>([])
  const [energy, setEnergy] = useState<Energy | null>(null)
  const [loaded, setLoaded] = useState(false)
  // text shared into the PWA prefills the composer - reviewed, never auto-sent
  const [message, setMessage] = useState(() => consumeSharedText() ?? '')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<NoticeState | null>(null)
  const [loadError, setLoadError] = useState(false)
  const loadedRef = useRef(false)
  // routines the user opened or closed by hand; the rest follow "up next"
  const [openOverride, setOpenOverride] = useState<Record<string, boolean>>({})
  const [nudgePromptOff, setNudgePromptOff] = useState(() => localStorage.getItem(NUDGE_PROMPT_KEY) === '1')
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [undo, setUndo] = useState<UndoState | null>(null)
  // the undo toast keeps its last content while the exit transition plays
  const toast = usePresence(undo !== null)
  const lastUndo = useRef(undo)
  if (undo) lastUndo.current = undo
  const [answer, setAnswer] = useState<AnswerState | null>(null)
  // the sheet keeps its last answer on screen while the exit transition plays
  const answerPresence = usePresence(answer !== null)
  const lastAnswer = useRef(answer)
  if (answer) lastAnswer.current = answer
  const [playing, setPlaying] = useState<{ routineId: string; focusTaskId?: string | null } | null>(null)
  // the player keeps rendering its last routine while the exit plays
  const player = usePresence(playing !== null)
  const lastPlaying = useRef(playing)
  if (playing) lastPlaying.current = playing
  const [listening, setListening] = useState(false)
  const [nudges, setNudges] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown')
  const [nowMin, setNowMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())
  const recognitionRef = useRef<{ stop: () => void } | null>(null)
  const today = localDate()
  const weekday = isoWeekday()

  // minute tick keeps anchor sort + countdown ring honest (time blindness aid)
  useEffect(() => {
    const tick = setInterval(() => setNowMin(new Date().getHours() * 60 + new Date().getMinutes()), 60_000)
    return () => clearInterval(tick)
  }, [])

  useEffect(() => {
    getNudgeState().then(setNudges)
  }, [])

  const load = useCallback(async () => {
    const [routinesRes, logsRes, stateRes, remindersRes] = await Promise.all([
      supabase
        .from('routines')
        .select('id, name, category, sort_order, anchor_time, active, tasks(id, routine_id, label, sort_order, scheduled_days, tier)')
        .eq('active', true)
        .order('sort_order'),
      supabase.from('task_logs').select('*').eq('date', today),
      supabase.from('daily_state').select('energy').eq('date', today).maybeSingle(),
      supabase.from('reminders').select('*').in('status', ['auto', 'reassigned']),
    ])
    // a failed first load must not pass for an empty day; a failed refresh
    // keeps what is already on screen
    if (routinesRes.error) {
      if (!loadedRef.current) setLoadError(true)
      return
    }
    setLoadError(false)
    loadedRef.current = true
    setRoutines((routinesRes.data as Routine[]) ?? [])
    const logMap = new Map(((logsRes.data as TaskLog[]) ?? []).map((l) => [l.task_id, l]))
    // taps still waiting on a bad connection win over the server's older answer
    for (const tap of pendingTaps()) {
      if (tap.date !== today) continue
      const existing = logMap.get(tap.task_id)
      logMap.set(tap.task_id, {
        ...(existing ?? { id: '', task_id: tap.task_id, date: today, completed_via: 'manual', notes: null }),
        status: tap.status,
      })
    }
    setLogs(logMap)
    setEnergy((stateRes.data?.energy as Energy) ?? null)
    setReminders(((remindersRes.data as Reminder[]) ?? []).sort(pendingOrder))
    setLoaded(true)
  }, [today])

  // refresh whenever the tab is shown - silent, the old data stays on screen
  useEffect(() => {
    if (visible) load()
  }, [visible, load])

  useEffect(() => {
    const channel = supabase
      .channel('now-view')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_logs' }, load)
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
    // when queued on bad signal, keep the optimistic state - load() lays
    // queued taps over the server rows, so a refresh keeps it too
    try {
      if ((await setTaskStatus(task.id, next)) === 'saved') load()
    } catch (err) {
      // the server refused it (not a connection problem): show the truth
      setNotice({ tone: 'error', text: t.now.somethingWrong((err as { message?: string }).message ?? String(err)) })
      load()
    }
  }

  async function send() {
    const text = message.trim()
    if (!text || busy) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await interpretMessage(text)
      if (result === 'queued') {
        setNotice({ tone: 'info', text: t.now.offlineQueued })
      } else if (result.error) {
        setNotice({ tone: 'error', text: t.now.somethingWrong(result.error) })
      } else {
        setMessage('')
        setSuggestions(result.suggestions)
        if (result.answers && result.answers.length > 0) {
          setAnswer({ question: text, lines: result.answers })
        }
        if (result.applied.length > 0 && result.ai_action_id) {
          setUndo({ aiActionId: result.ai_action_id, response: result })
        } else if (result.applied.length === 0 && result.suggestions.length === 0 && !result.answers?.length) {
          setNotice({ tone: 'info', text: t.now.noMatch })
        }
        load()
      }
    } catch (err) {
      setNotice(
        err instanceof AiLimitError
          ? { tone: 'warn', text: t.now.aiDailyLimit }
          : { tone: 'error', text: t.now.cantReachAi(String(err)) },
      )
    } finally {
      setBusy(false)
    }
  }

  async function confirmSuggestion(s: Suggestion) {
    await setTaskStatus(s.task_id, s.status, 'ai_text')
    setSuggestions((prev) => prev.filter((x) => x.task_id !== s.task_id))
    load()
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
      setNotice({ tone: 'info', text: t.now.voiceUnsupported })
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SpeechRecognition as any)()
    rec.lang = t.now.speechLang
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
        .filter((task) => task.scheduled_days.includes(weekday) && visibleTiers.includes(task.tier))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
    .filter((s) => s.tasks.length > 0)
    .map((s) => {
      const doneCount = s.tasks.filter((task) => {
        const status = logs.get(task.id)?.status
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

  // "up next": deterministic, instant, free - the first pending core task of
  // the top incomplete routine (anchor sorting already made that the right one)
  const upNext = (() => {
    const section = sections.find((s) => !s.complete)
    if (!section) return null
    const pending = (task: Task) => {
      const status = logs.get(task.id)?.status
      return status !== 'done' && status !== 'skipped' && status !== 'partial'
    }
    const task = section.tasks.find((x) => x.tier === 'core' && pending(x)) ?? section.tasks.find(pending)
    if (!task) return null
    const eta =
      section.anchorDiff !== null && Math.abs(section.anchorDiff) <= ANCHOR_WINDOW ? fmtEta(section.anchorDiff) : null
    return { routine: section.routine, task, eta }
  })()

  // the message box grows with what is typed and shrinks back when sent
  useEffect(() => {
    const el = composerRef.current
    if (!el) return
    el.style.height = 'auto'
    if (message) el.style.height = `${el.scrollHeight}px`
    el.style.overflowY = el.scrollHeight > el.clientHeight + 1 ? 'auto' : 'hidden'
  }, [message])

  async function turnOnNudges() {
    const result = await enableNudges()
    if (result === 'on') setNudges('on')
    else if (result === 'denied') setNotice({ tone: 'warn', text: t.now.notifBlocked })
  }

  function dismissNudgePrompt() {
    localStorage.setItem(NUDGE_PROMPT_KEY, '1')
    setNudgePromptOff(true)
  }

  // reminders that are due (today or earlier) stay on this screen in full;
  // the rest are one tap away
  const dueReminders = reminders.filter((r) => r.due_date && r.due_date <= today).slice(0, 4)
  const now = new Date()

  return (
    <div className="screen today">
      <ScreenHeader
        eyebrow={now.toLocaleDateString(locale, { weekday: 'long' })}
        title={now.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}
        onOpenSettings={onOpenSettings}
      />

      {/* an answer can take several seconds: the box must show it is working */}
      <div className={busy ? 'composer composer--busy' : 'composer'} aria-busy={busy || undefined}>
        <textarea
          ref={composerRef}
          value={message}
          maxLength={MAX_LEN.message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder={t.now.composerPh}
          aria-label={t.now.composerPh}
          readOnly={busy}
          rows={1}
        />
        {/* empty: the way to the log of past messages; typing: Send takes its place */}
        {!message.trim() && <IconButton icon="clock" label={t.history.title} onClick={onOpenLog} />}
        <IconButton
          icon="mic"
          label={t.now.voiceInput}
          aria-pressed={listening}
          onClick={() => (listening ? recognitionRef.current?.stop() : startVoice())}
        />
        {message.trim() && <IconButton icon="arrow-up" variant="primary" label={t.now.send} onClick={send} busy={busy} />}
      </div>

      {notice && (
        <Notice tone={notice.tone} onDismiss={() => setNotice(null)}>
          {notice.text}
        </Notice>
      )}

      {suggestions.length > 0 && (
        <div className="cluster">
          <span className="hint">{t.now.didYouMean}</span>
          {suggestions.map((s) => (
            <button key={s.task_id} type="button" className="chip" onClick={() => confirmSuggestion(s)}>
              <Icon name={s.status === 'skipped' ? 'skip' : 'check'} /> {s.label}
            </button>
          ))}
          <Button variant="ghost" size="sm" icon="x" onClick={() => setSuggestions([])}>
            {t.now.no}
          </Button>
        </div>
      )}

      <div className="field field--inline today__energy">
        <span className="field__label">{t.now.energyToday}</span>
        <Segmented options={ENERGY_OPTIONS} value={energy} onChange={pickEnergy} label={t.now.energyToday} />
      </div>
      {energy === 'low' && <p className="hint">{t.now.lowEnergyNote}</p>}

      {loadError && !loaded && <ErrorState onRetry={load} />}

      {loaded && upNext && (
        <Card tone="feature" className="upnext">
          <p className="eyebrow upnext__label">
            {t.now.upNext} · {upNext.routine.name}
            {upNext.eta ? ` · ${upNext.eta}` : ''}
          </p>
          <p className="upnext__task">{upNext.task.label}</p>
          <div className="actions">
            <Button variant="primary" className="upnext__done" onClick={() => tapStatus(upNext.task, 'done')}>
              {t.common.done}
            </Button>
            <Button onClick={() => tapStatus(upNext.task, 'skipped')}>{t.common.skip}</Button>
            <IconButton
              icon="play"
              variant="filled"
              label={t.now.startTitle}
              onClick={() => setPlaying({ routineId: upNext.routine.id, focusTaskId: upNext.task.id })}
            />
          </div>
        </Card>
      )}

      {loaded && dueReminders.length > 0 && (
        <Card
          title={t.now.remindersTitle}
          meta={reminders.length}
          action={
            <Button variant="ghost" size="sm" onClick={onOpenReminders}>
              {reminders.length > dueReminders.length ? t.now.seeAll(reminders.length) : t.now.open}
            </Button>
          }
        >
          <div className="rows">
            {dueReminders.map((r) => {
              const due = describeDue(r.due_date!, today)
              return (
                <div key={r.id} className="row">
                  <div className="row__main">
                    {r.raw_text}{' '}
                    <span className={due.overdue ? 'badge badge--accent' : 'badge'}>
                      <Icon name={due.overdue ? 'hourglass' : 'calendar'} /> {due.label}
                      {r.due_time ? ` · ${shortTime(r.due_time)}` : ''}
                    </span>
                  </div>
                  <Button size="sm" onClick={() => clearReminder(r)}>
                    {t.common.done}
                  </Button>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {!loaded && !loadError && <Skeleton cards={3} />}

      {loaded && sections.length > 0 && (
        <div className="stack">
          {sections.map(({ routine, tasks, doneCount, complete: allHandled, anchorDiff }) => {
            const showRing = routine.id === activeAnchorId && anchorDiff !== null
            const ringPct = showRing ? Math.round(((ANCHOR_WINDOW - Math.min(Math.abs(anchorDiff), ANCHOR_WINDOW)) / ANCHOR_WINDOW) * 100) : 0
            // open by default: the routine "up next" belongs to, and one whose time is near
            const open = openOverride[routine.id] ?? (!allHandled && (routine.id === upNext?.routine.id || routine.id === activeAnchorId))
            return (
              <section key={routine.id} className={cx('card routine', allHandled && 'routine--done')}>
                <div className="routine__head">
                  <h2 className="routine__title">
                    <button
                      type="button"
                      className="routine__toggle"
                      aria-expanded={open}
                      onClick={() => setOpenOverride((prev) => ({ ...prev, [routine.id]: !open }))}
                    >
                      <Icon name="chevron-down" className="disclosure__chevron" />
                      <span className="routine__name">{routine.name}</span>
                    </button>
                  </h2>
                  {showRing && (
                    <span className="badge badge--accent" title={t.now.anchoredAround(routine.anchor_time?.slice(0, 5) ?? '')}>
                      <span
                        className="anchor-ring"
                        style={{ background: `conic-gradient(var(--accent) ${ringPct}%, var(--surface-3) 0)` }}
                        aria-hidden="true"
                      />
                      {fmtEta(anchorDiff!)}
                    </span>
                  )}
                  <span className="meta">{allHandled ? <Icon name="check" /> : `${doneCount}/${tasks.length}`}</span>
                  {!allHandled && (
                    <IconButton icon="play" label={`${t.now.start}: ${routine.name}`} onClick={() => setPlaying({ routineId: routine.id })} />
                  )}
                </div>
                <ProgressBar value={doneCount / tasks.length} tone="good" />
                {open && (
                  <div className="rows">
                    {tasks.map((task) => {
                      const status = logs.get(task.id)?.status ?? 'pending'
                      return (
                        <div key={task.id} className={`row task task--${status}`}>
                          <button
                            type="button"
                            className="check"
                            aria-pressed={status === 'done'}
                            aria-label={`${t.common.done}: ${task.label}`}
                            onClick={() => tapStatus(task, 'done')}
                          >
                            <span className="check__box">{(status === 'done' || status === 'partial') && <Icon name="check" />}</span>
                          </button>
                          <span className="row__main">{task.label}</span>
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm task__skip"
                            aria-pressed={status === 'skipped'}
                            onClick={() => tapStatus(task, 'skipped')}
                          >
                            {t.common.skip}
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}

      {loaded && sections.length === 0 && <EmptyState icon="leaf">{t.now.nothingScheduled}</EmptyState>}

      {loaded && dueReminders.length === 0 && (
        <ListRow
          icon="bell"
          label={t.now.remindersTitle}
          meta={reminders.length > 0 ? reminders.length : t.now.nothingOnHold}
          onClick={onOpenReminders}
        />
      )}

      {loaded && nudges === 'off' && !nudgePromptOff && (
        <Notice icon="bell" onDismiss={dismissNudgePrompt}>
          <Button variant="ghost" size="sm" onClick={turnOnNudges}>
            {t.now.enableNudges}
          </Button>
        </Notice>
      )}

      {player.mounted &&
        (() => {
          const p = playing ?? lastPlaying.current
          const s = p && sections.find((x) => x.routine.id === p.routineId)
          if (!p || !s) return null
          return (
            <Player
              routineName={s.routine.name}
              tasks={s.tasks}
              logs={logs}
              focusTaskId={p.focusTaskId}
              onStatus={tapStatus}
              onExit={() => setPlaying(null)}
              closing={player.closing}
            />
          )
        })()}

      {toast.mounted &&
        (() => {
          const u = undo ?? lastUndo.current
          if (!u) return null
          return (
            <div className="toast" role="status" data-closing={toast.closing || undefined}>
              <div className="toast__body">
                {u.response.applied.map((a, i) => {
                  const d = describeAction(a)
                  return (
                    <div key={i}>
                      <Icon name={d.icon} /> {d.text}
                    </div>
                  )
                })}
              </div>
              <Button variant="ghost" size="sm" onClick={runUndo}>
                {t.common.undo}
              </Button>
              <IconButton icon="x" label={t.common.dismiss} onClick={() => setUndo(null)} />
            </div>
          )
        })()}

      {answerPresence.mounted && (answer ?? lastAnswer.current) && (
        <AnswerSheet
          answer={(answer ?? lastAnswer.current)!}
          onClose={() => setAnswer(null)}
          onOpenLog={() => {
            setAnswer(null)
            onOpenLog()
          }}
          closing={answerPresence.closing}
        />
      )}
    </div>
  )
}
