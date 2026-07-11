import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { CardioLog } from '../lib/types'
import { runOp } from '../lib/offline'
import { DEFAULT_BASE_KM, cardioTargetForWeek } from '../lib/cardioPlan'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'

// labels stay plain text because they also render inside <option> elements,
// which can't hold SVG; the entry list gets its icon from kindIcon below
const CARDIO_KINDS = [
  ['run', 'Run'],
  ['walk', 'Walk'],
  ['cycle', 'Cycle'],
  ['swim', 'Swim'],
] as const

const KIND_ICONS: Record<string, IconName> = { run: 'run', walk: 'walk', cycle: 'bike', swim: 'waves' }

// the strength check-in questions, adapted to cardio - saved per entry
const CARDIO_QUESTIONS: { field: 'effort' | 'body' | 'amount'; label: string; options: [string, string][] }[] = [
  {
    field: 'effort',
    label: 'How hard did it feel?',
    options: [
      ['easy', 'Easy'],
      ['steady', 'Steady'],
      ['pushed', 'Pushed'],
      ['all_out', 'All out'],
    ],
  },
  {
    field: 'body',
    label: 'How was the body?',
    options: [
      ['fresh', 'Fresh'],
      ['okay', 'Okay'],
      ['heavy', 'Heavy'],
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

/** minutes over km -> "6:24 /km" */
function fmtPace(minutes: number | null, km: number | null): string | null {
  if (!minutes || !km || km <= 0) return null
  const perKm = minutes / km
  const m = Math.floor(perKm)
  const s = Math.round((perKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')} /km`
}

/** Monday (yyyy-mm-dd) of the week containing the given date string. */
function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return localDate(d)
}

interface Props {
  cardio: CardioLog[]
  setCardio: Dispatch<SetStateAction<CardioLog[]>>
  week: number | null
  cardioBase: number | null // null = still loading
  onSaveBase: (v: number) => void
  reload: () => void
}

/** The Workout tab's Cardio view: weekly plan rail, quick log, per-day bars,
 *  the entry list with inline edit + check-in. Owns all cardio-only UI state;
 *  the data itself (entries, base km, program week) lives in Gym's load. */
export default function GymCardio({ cardio, setCardio, week, cardioBase, onSaveBase, reload }: Props) {
  const [run, setRun] = useState({ kind: 'run', km: '', min: '', hr: '' })
  const [loggingRun, setLoggingRun] = useState(false)
  const [baseDraft, setBaseDraft] = useState(cardioBase != null ? String(cardioBase) : '')
  const [editCardio, setEditCardio] = useState<{ id: string; kind: string; km: string; min: string; hr: string; notes: string; date: string } | null>(null)

  useEffect(() => {
    if (cardioBase != null) setBaseDraft(String(cardioBase))
  }, [cardioBase])

  function saveBase() {
    const v = parseFloat(baseDraft)
    if (!Number.isFinite(v) || v <= 0) return
    onSaveBase(v)
  }

  async function logRun() {
    const km = parseFloat(run.km)
    const min = parseFloat(run.min)
    const hr = parseInt(run.hr, 10)
    if (loggingRun || (!Number.isFinite(km) && !Number.isFinite(min))) return
    setLoggingRun(true)
    try {
      // client-generated id: works identically online and queued-offline
      const entry: CardioLog = {
        id: crypto.randomUUID(),
        session_id: null,
        date: localDate(),
        kind: run.kind,
        distance_km: Number.isFinite(km) ? km : null,
        minutes: Number.isFinite(min) ? min : null,
        avg_hr: Number.isFinite(hr) ? hr : null,
        notes: null,
      }
      const result = await runOp({ table: 'cardio_logs', op: 'insert', values: entry as unknown as Record<string, unknown> })
      setRun({ ...run, km: '', min: '', hr: '' })
      if (result === 'saved') reload()
      else setCardio((prev) => [entry, ...prev]) // optimistic while offline
      // offer the check-in right away - each pill saves on tap, closing skips
      setEditCardio({
        id: entry.id,
        kind: run.kind,
        km: Number.isFinite(km) ? String(km) : '',
        min: Number.isFinite(min) ? String(min) : '',
        hr: Number.isFinite(hr) ? String(hr) : '',
        notes: '',
        date: entry.date,
      })
    } finally {
      setLoggingRun(false)
    }
  }

  async function setCardioFeel(id: string, field: 'effort' | 'body' | 'amount', value: string) {
    const current = cardio.find((c) => c.id === id)?.[field]
    const next = current === value ? null : value // tap again to unset
    setCardio((prev) => prev.map((c) => (c.id === id ? { ...c, [field]: next } : c)))
    await runOp({ table: 'cardio_logs', op: 'update', ids: [id], values: { [field]: next } })
  }

  async function saveCardio() {
    if (!editCardio) return
    const km = parseFloat(editCardio.km)
    const min = parseFloat(editCardio.min)
    const hr = parseInt(editCardio.hr, 10)
    const values = {
      kind: editCardio.kind,
      distance_km: Number.isFinite(km) ? km : null,
      minutes: Number.isFinite(min) ? min : null,
      avg_hr: Number.isFinite(hr) ? hr : null,
      notes: editCardio.notes.trim() || null,
      ...(editCardio.date ? { date: editCardio.date } : {}), // don't null a not-null column if cleared
    }
    setCardio((prev) => prev.map((c) => (c.id === editCardio.id ? { ...c, ...values } : c)))
    setEditCardio(null)
    if ((await runOp({ table: 'cardio_logs', op: 'update', ids: [editCardio.id], values })) === 'saved') reload()
  }

  async function deleteCardio(id: string) {
    await supabase.from('cardio_logs').delete().eq('id', id)
    setEditCardio(null)
    reload()
  }

  const thisMonday = mondayOf(localDate())
  const thisWeek = cardio.filter((c) => mondayOf(c.date) === thisMonday)
  const weekKm = thisWeek.reduce((n, c) => n + Number(c.distance_km ?? 0), 0)
  const weekMin = thisWeek.reduce((n, c) => n + Number(c.minutes ?? 0), 0)
  // this week, Monday to Sunday, one stacked bar per day
  const KIND_ORDER = ['run', 'walk', 'cycle', 'swim', 'other']
  const today = localDate()
  const weeks: { num: string; kinds: Map<string, number>; total: number; now: boolean }[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(thisMonday + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const date = localDate(d)
    const kinds = new Map<string, number>()
    for (const c of cardio) {
      if (c.date !== date) continue
      const km = Number(c.distance_km ?? 0)
      if (!km) continue
      const kind = KIND_ORDER.includes(c.kind) ? c.kind : 'other'
      kinds.set(kind, (kinds.get(kind) ?? 0) + km)
    }
    const total = [...kinds.values()].reduce((a, b) => a + b, 0)
    weeks.push({
      num: d.toLocaleDateString(undefined, { weekday: 'short' }),
      kinds,
      total,
      now: date === today,
    })
  }
  const maxKm = Math.max(1, ...weeks.map((w) => w.total))
  const presentKinds = KIND_ORDER.filter((k) => weeks.some((w) => w.kinds.has(k)))
  const runs = cardio.filter((c) => Number(c.distance_km ?? 0) >= 1 && c.minutes)
  const longest = runs.length ? Math.max(...runs.map((c) => Number(c.distance_km))) : null
  const paces = runs.filter((c) => Number(c.distance_km) >= 2).map((c) => Number(c.minutes) / Number(c.distance_km))
  const bestPace = paces.length ? Math.min(...paces) : null
  const kindIcon = (k: string): IconName => KIND_ICONS[k] ?? 'run'
  const target = cardioTargetForWeek(cardioBase ?? DEFAULT_BASE_KM, week ?? 1)
  const pct = Math.min(100, Math.round((weekKm / target.km) * 100))

  return (
    <section className="gym-day cardio-card">
      <h2>
        Cardio
        <span className="routine-progress">
          {weekKm > 0 || weekMin > 0
            ? ` this week: ${weekKm > 0 ? `${Math.round(weekKm * 10) / 10} km` : ''}${weekKm > 0 && weekMin > 0 ? ' · ' : ''}${weekMin > 0 ? `${Math.round(weekMin)} min` : ''}`
            : ' nothing yet this week — that’s allowed'}
        </span>
      </h2>

      <div className="cardio-plan">
        <div className="cardio-plan-head">
          <span className="cardio-plan-phase">{target.phase} week</span>
          <span className="cardio-plan-target">
            aim ~{target.km} km · {target.sessions} easy sessions
          </span>
        </div>
        <div className="cardio-plan-rail" aria-hidden="true">
          <div className="cardio-plan-fill" style={{ width: `${pct}%` }} />
        </div>
        <p className="gentle cardio-plan-note">
          {Math.round(weekKm * 10) / 10} / {target.km} km so far. {target.note}
        </p>
        <div className="cardio-plan-base">
          <span className="gentle-inline">Easy-week base</span>
          <input
            type="number"
            inputMode="decimal"
            value={baseDraft}
            onChange={(e) => setBaseDraft(e.target.value)}
            onBlur={saveBase}
            onKeyDown={(e) => e.key === 'Enter' && saveBase()}
          />
          <span className="gentle-inline">km/week</span>
        </div>
      </div>

      <div className="run-log-row">
        <select value={run.kind} onChange={(e) => setRun({ ...run, kind: e.target.value })}>
          {CARDIO_KINDS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          placeholder="km"
          value={run.km}
          onChange={(e) => setRun({ ...run, km: e.target.value })}
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="min"
          value={run.min}
          onChange={(e) => setRun({ ...run, min: e.target.value })}
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder="bpm"
          value={run.hr}
          onChange={(e) => setRun({ ...run, hr: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && logRun()}
        />
        <button className="run-log-btn" onClick={logRun} disabled={loggingRun}>
          {loggingRun ? '…' : 'Log'}
        </button>
      </div>

      {weeks.some((w) => w.total > 0) && (
        <>
          <div className="run-weeks">
            {weeks.map((w, i) => (
              <div
                key={i}
                className="reflect-day"
                title={`${w.num}: ${[...w.kinds.entries()].map(([k, v]) => `${k} ${Math.round(v * 10) / 10}km`).join(', ') || 'nothing'}`}
              >
                <div className="bar-wrap run-bar-wrap">
                  <div className={w.now && w.total > 0 ? 'run-stack now' : 'run-stack'}>
                    {KIND_ORDER.filter((k) => w.kinds.has(k)).map((k) => (
                      <div key={k} className={`run-seg ${k}`} style={{ height: `${(w.kinds.get(k)! / maxKm) * 100}%` }} />
                    ))}
                  </div>
                </div>
                <span className="bar-count">{w.total > 0 ? Math.round(w.total * 10) / 10 : ''}</span>
                <span className={w.now ? 'bar-day now-label' : 'bar-day'}>{w.num}</span>
              </div>
            ))}
          </div>
          {presentKinds.length > 1 && (
            <div className="run-legend">
              {presentKinds.map((k) => (
                <span key={k} className="run-legend-item">
                  <span className={`run-dot ${k}`} />
                  {k}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {(longest || bestPace) && (
        <p className="gentle run-stats">
          {longest ? `Longest: ${longest} km` : ''}
          {longest && bestPace ? ' · ' : ''}
          {bestPace ? `Best pace: ${fmtPace(bestPace, 1)}` : ''}
        </p>
      )}

      {(() => {
        const recent = cardio.filter(
          (c) => Date.now() - new Date(c.date + 'T00:00:00').getTime() < 14 * 86400000,
        )
        const over = recent.filter((c) => c.amount === 'over_the_line').length
        const more = recent.filter((c) => c.amount === 'could_take_more').length
        if (over >= 2 && !localStorage.getItem('cardio-sugg-over')) {
          return (
            <div className="notice vol-suggestion">
              Cardio has said “over the line” a couple of times lately — an easier week is a fine plan.
              <button
                className="link"
                onClick={() => {
                  localStorage.setItem('cardio-sugg-over', '1')
                  reload()
                }}
                aria-label="Dismiss"
              >
                <Icon name="x" />
              </button>
            </div>
          )
        }
        if (more >= 2 && over === 0 && !localStorage.getItem('cardio-sugg-more')) {
          return (
            <div className="notice vol-suggestion">
              Cardio keeps saying “could take more” — want to nudge the distance up a little?
              <button
                className="link"
                onClick={() => {
                  localStorage.setItem('cardio-sugg-more', '1')
                  reload()
                }}
                aria-label="Dismiss"
              >
                <Icon name="x" />
              </button>
            </div>
          )
        }
        return null
      })()}

      {cardio.slice(0, 12).map((c) => {
        const pace = fmtPace(Number(c.minutes), Number(c.distance_km))
        if (editCardio?.id === c.id) {
          return (
            <div key={c.id} className="edit-task cardio-edit">
              <div className="edit-task-row">
                <input
                  type="date"
                  value={editCardio.date}
                  onChange={(e) => setEditCardio({ ...editCardio, date: e.target.value })}
                  title="Date"
                />
              </div>
              <div className="edit-task-row">
                <select value={editCardio.kind} onChange={(e) => setEditCardio({ ...editCardio, kind: e.target.value })}>
                  {CARDIO_KINDS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="km"
                  value={editCardio.km}
                  onChange={(e) => setEditCardio({ ...editCardio, km: e.target.value })}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="min"
                  value={editCardio.min}
                  onChange={(e) => setEditCardio({ ...editCardio, min: e.target.value })}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="bpm"
                  value={editCardio.hr}
                  onChange={(e) => setEditCardio({ ...editCardio, hr: e.target.value })}
                />
              </div>
              <div className="edit-task-row">
                <input
                  placeholder="notes"
                  value={editCardio.notes}
                  onChange={(e) => setEditCardio({ ...editCardio, notes: e.target.value })}
                />
              </div>
              {CARDIO_QUESTIONS.map((q) => (
                <div key={q.field} className="checkin-q">
                  <span className="energy-label">{q.label}</span>
                  <div className="checkin-pills">
                    {q.options.map(([value, label]) => (
                      <button
                        key={value}
                        className={c[q.field] === value ? 'energy-btn active' : 'energy-btn'}
                        onClick={() => setCardioFeel(c.id, q.field, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="edit-task-row">
                <button className="save" onClick={saveCardio}>
                  Save
                </button>
                <button className="link" onClick={() => setEditCardio(null)}>
                  Close
                </button>
                <ConfirmButton
                  className="danger"
                  label="Delete"
                  confirmLabel="delete this entry?"
                  onConfirm={() => deleteCardio(c.id)}
                />
              </div>
            </div>
          )
        }
        return (
          <div key={c.id} className="gym-entry run-entry">
            <span className="gym-exercise">
              <Icon name={kindIcon(c.kind)} /> {c.date}
            </span>
            <span className="gym-sets">
              {c.distance_km ? `${c.distance_km} km` : ''}
              {c.distance_km && c.minutes ? ' · ' : ''}
              {c.minutes ? `${c.minutes} min` : ''}
              {pace ? ` · ${pace}` : ''}
              {c.avg_hr ? ` · ${c.avg_hr} bpm` : ''}
            </span>
            <button
              className="link run-edit"
              onClick={() =>
                setEditCardio({
                  id: c.id,
                  kind: c.kind,
                  km: c.distance_km != null ? String(c.distance_km) : '',
                  min: c.minutes != null ? String(c.minutes) : '',
                  hr: c.avg_hr != null ? String(c.avg_hr) : '',
                  notes: c.notes ?? '',
                  date: c.date,
                })
              }
            >
              edit
            </button>
            {c.notes && <span className="gym-notes">{c.notes}</span>}
          </div>
        )
      })}
      {cardio.length === 0 && (
        <p className="gentle">
          Log above, tell the composer <em>“ran 5k in 32 min”</em>, or finish a Pull session — they all land here.
        </p>
      )}
    </section>
  )
}
