import { useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { supabase } from '../lib/supabase'
import { localDate } from '../lib/types'
import type { CardioLog } from '../lib/types'
import { runOp } from '../lib/offline'
import { DEFAULT_BASE_KM, cardioTargetForWeek } from '../lib/cardioPlan'
import { t, locale } from '../i18n'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'

// labels stay plain text because they also render inside <option> elements,
// which can't hold SVG; the entry list gets its icon from kindIcon below
const CARDIO_KINDS = ['run', 'walk', 'cycle', 'swim'] as const

const KIND_ICONS: Record<string, IconName> = { run: 'run', walk: 'walk', cycle: 'bike', swim: 'waves' }

const kindLabel = (k: string) => t.cardio.kinds[k] ?? k

// the strength check-in questions, adapted to cardio - saved per entry
const CARDIO_QUESTIONS: ('effort' | 'body' | 'amount')[] = ['effort', 'body', 'amount']

/** minutes over km -> "6:24 /km" */
function fmtPace(minutes: number | null, km: number | null): string | null {
  if (!minutes || !km || km <= 0) return null
  const perKm = minutes / km
  const m = Math.floor(perKm)
  const s = Math.round((perKm - m) * 60)
  return `${m}:${String(s).padStart(2, '0')} ${t.cardio.perKm}`
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
  const [editingBase, setEditingBase] = useState(false)
  const [editCardio, setEditCardio] = useState<{ id: string; kind: string; km: string; min: string; hr: string; notes: string; date: string } | null>(null)

  useEffect(() => {
    if (cardioBase != null && !editingBase) setBaseDraft(String(cardioBase))
  }, [cardioBase, editingBase])

  // explicit save only - typing in the field must never touch the database
  function saveBase() {
    const v = parseFloat(baseDraft)
    if (!Number.isFinite(v) || v <= 0) return
    onSaveBase(v)
    setEditingBase(false)
  }

  function cancelBase() {
    setBaseDraft(cardioBase != null ? String(cardioBase) : '')
    setEditingBase(false)
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
      num: d.toLocaleDateString(locale, { weekday: 'short' }),
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
        {t.cardio.title}
        <span className="routine-progress">
          {weekKm > 0 || weekMin > 0
            ? t.cardio.thisWeek(
                `${weekKm > 0 ? t.cardio.km(Math.round(weekKm * 10) / 10) : ''}${weekKm > 0 && weekMin > 0 ? ' · ' : ''}${weekMin > 0 ? t.cardio.min(Math.round(weekMin)) : ''}`,
              )
            : t.cardio.nothingYet}
        </span>
      </h2>

      <div className="cardio-plan">
        <div className="cardio-plan-head">
          <span className="cardio-plan-phase">{t.cardio.phaseWeek(t.cardioPlan.phases[target.phase] ?? target.phase)}</span>
          <span className="cardio-plan-target">
            {t.cardio.aim(target.km, target.sessions)}
          </span>
        </div>
        <div className="cardio-plan-rail" aria-hidden="true">
          <div className="cardio-plan-fill" style={{ transform: `scaleX(${pct / 100})` }} />
        </div>
        <p className="gentle cardio-plan-note">
          {t.cardio.soFar(Math.round(weekKm * 10) / 10, target.km, target.note)}
        </p>
        <div className="cardio-plan-base">
          <span className="gentle-inline">{t.cardio.easyWeekBase}</span>
          {editingBase ? (
            <>
              <input
                type="number"
                inputMode="decimal"
                value={baseDraft}
                autoFocus
                onChange={(e) => setBaseDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveBase()
                  if (e.key === 'Escape') cancelBase()
                }}
              />
              <span className="gentle-inline">{t.cardio.kmPerWeek}</span>
              <button className="save" onClick={saveBase} disabled={!(parseFloat(baseDraft) > 0)}>
                {t.common.save}
              </button>
              <button className="energy-btn" onClick={cancelBase}>
                {t.common.cancel}
              </button>
            </>
          ) : (
            <>
              <span className="gentle-inline">{t.cardio.baseValue(cardioBase ?? DEFAULT_BASE_KM)}</span>
              <button className="energy-btn" onClick={() => setEditingBase(true)} disabled={cardioBase == null}>
                {t.common.Edit}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="run-log-row">
        <select value={run.kind} onChange={(e) => setRun({ ...run, kind: e.target.value })}>
          {CARDIO_KINDS.map((value) => (
            <option key={value} value={value}>
              {kindLabel(value)}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          placeholder={t.cardio.kmPh}
          value={run.km}
          onChange={(e) => setRun({ ...run, km: e.target.value })}
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder={t.cardio.minPh}
          value={run.min}
          onChange={(e) => setRun({ ...run, min: e.target.value })}
        />
        <input
          type="number"
          inputMode="numeric"
          placeholder={t.cardio.bpmPh}
          value={run.hr}
          onChange={(e) => setRun({ ...run, hr: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && logRun()}
        />
        <button className="run-log-btn" onClick={logRun} disabled={loggingRun}>
          {loggingRun ? '…' : t.cardio.log}
        </button>
      </div>

      {weeks.some((w) => w.total > 0) && (
        <>
          <div className="run-weeks">
            {weeks.map((w, i) => (
              <div
                key={i}
                className="reflect-day"
                title={t.cardio.dayTitle(
                  w.num,
                  [...w.kinds.entries()].map(([k, v]) => t.cardio.kindKm(kindLabel(k), Math.round(v * 10) / 10)).join(', ') ||
                    t.cardio.nothing,
                )}
              >
                <div className="bar-wrap run-bar-wrap">
                  <div className={w.now && w.total > 0 ? 'run-stack now' : 'run-stack'}>
                    {w.total > 0 ? (
                      KIND_ORDER.filter((k) => w.kinds.has(k)).map((k) => (
                        <div key={k} className={`run-seg ${k}`} style={{ height: `${(w.kinds.get(k)! / maxKm) * 100}%` }} />
                      ))
                    ) : (
                      // same 2px accent dash the Explore chart shows at zero
                      <div className="run-seg empty" />
                    )}
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
                  {kindLabel(k)}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      {(longest || bestPace) && (
        <p className="gentle run-stats">
          {longest ? t.cardio.longest(longest) : ''}
          {longest && bestPace ? ' · ' : ''}
          {bestPace ? t.cardio.bestPace(fmtPace(bestPace, 1) ?? '') : ''}
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
              {t.cardio.overNotice}
              <button
                className="link"
                onClick={() => {
                  localStorage.setItem('cardio-sugg-over', '1')
                  reload()
                }}
                aria-label={t.common.dismiss}
              >
                <Icon name="x" />
              </button>
            </div>
          )
        }
        if (more >= 2 && over === 0 && !localStorage.getItem('cardio-sugg-more')) {
          return (
            <div className="notice vol-suggestion">
              {t.cardio.moreNotice}
              <button
                className="link"
                onClick={() => {
                  localStorage.setItem('cardio-sugg-more', '1')
                  reload()
                }}
                aria-label={t.common.dismiss}
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
                  title={t.cardio.dateTitle}
                />
              </div>
              <div className="edit-task-row">
                <select value={editCardio.kind} onChange={(e) => setEditCardio({ ...editCardio, kind: e.target.value })}>
                  {CARDIO_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {kindLabel(value)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder={t.cardio.kmPh}
                  value={editCardio.km}
                  onChange={(e) => setEditCardio({ ...editCardio, km: e.target.value })}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={t.cardio.minPh}
                  value={editCardio.min}
                  onChange={(e) => setEditCardio({ ...editCardio, min: e.target.value })}
                />
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder={t.cardio.bpmPh}
                  value={editCardio.hr}
                  onChange={(e) => setEditCardio({ ...editCardio, hr: e.target.value })}
                />
              </div>
              <div className="edit-task-row">
                <input
                  placeholder={t.cardio.notesPh}
                  value={editCardio.notes}
                  onChange={(e) => setEditCardio({ ...editCardio, notes: e.target.value })}
                />
              </div>
              {CARDIO_QUESTIONS.map((field) => (
                <div key={field} className="checkin-q">
                  <span className="energy-label">{t.cardio.questions[field].label}</span>
                  <div className="checkin-pills">
                    {Object.entries(t.cardio.questions[field].options).map(([value, label]) => (
                      <button
                        key={value}
                        className={c[field] === value ? 'energy-btn active' : 'energy-btn'}
                        onClick={() => setCardioFeel(c.id, field, value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div className="edit-task-row">
                <button className="save" onClick={saveCardio}>
                  {t.common.save}
                </button>
                <button className="link" onClick={() => setEditCardio(null)}>
                  {t.common.close}
                </button>
                <ConfirmButton
                  className="danger"
                  label={t.common.delete}
                  confirmLabel={t.cardio.deleteConfirm}
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
              {c.distance_km ? t.cardio.km(Number(c.distance_km)) : ''}
              {c.distance_km && c.minutes ? ' · ' : ''}
              {c.minutes ? t.cardio.min(Number(c.minutes)) : ''}
              {pace ? ` · ${pace}` : ''}
              {c.avg_hr ? ` · ${t.cardio.bpm(c.avg_hr)}` : ''}
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
              {t.common.edit}
            </button>
            {c.notes && <span className="gym-notes">{c.notes}</span>}
          </div>
        )
      })}
      {cardio.length === 0 && (
        <p className="gentle">
          {t.cardio.emptyHint}
          <em>{t.cardio.emptyHintExample}</em>
          {t.cardio.emptyHintTail}
        </p>
      )}
    </section>
  )
}
