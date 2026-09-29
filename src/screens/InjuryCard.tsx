import { useState } from 'react'
import { supabase } from '../lib/supabase'
import type { TrainingBlock, WorkoutPlan } from '../lib/types'
import { BODY_PARTS, SEVERITIES } from '../lib/injuryPlan'
import type { BodyPart, InjuryChange, PreviewLine, Severity } from '../lib/injuryPlan'
import { healInjury, previewInjury, reportInjury } from '../lib/injuries'
import type { Injury } from '../lib/injuries'
import { t, lang, locale } from '../i18n'
import { MAX_LEN } from '../lib/limits'
import ConfirmButton from '../components/ConfirmButton'
import Icon from '../components/Icon'

/** Ask the server to rewrite this week's coach note with the injury in view.
 *  Fire-and-forget: the card already shows the deterministic part, and the
 *  weekly cron catches up if this call fails. */
async function refreshCoach(): Promise<void> {
  try {
    await supabase.functions.invoke('refresh-coach', { body: { lang } })
  } catch {
    /* offline or the function is down - the weekly pass still covers it */
  }
}

function previewText(line: PreviewLine): string {
  const base =
    line.treatment === 'drop'
      ? t.injuries.lineDrop(line.exercise)
      : line.treatment === 'swap'
        ? t.injuries.lineSwap(line.exercise, line.replacement ?? '')
        : line.treatment === 'lighter'
          ? t.injuries.lineLighter(line.exercise)
          : line.treatment === 'cue'
            ? t.injuries.lineCue(line.exercise)
            : t.injuries.lineSwap(line.exercise, line.replacement ?? '')
  return base + t.injuries.sessions(line.sessions)
}

const setsTouched = (changes: InjuryChange[]) => changes.filter((c) => c.kind !== 'cardio').length

/** Report an injury -> preview how upcoming sessions change -> apply.
 *  Active injuries list below with "Healed", which restores the plan. */
export default function InjuryCard({
  injuries,
  block,
  plans,
  onChanged,
}: {
  injuries: Injury[]
  block: TrainingBlock | null
  plans: WorkoutPlan[]
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [part, setPart] = useState<BodyPart | null>(null)
  const [severity, setSeverity] = useState<Severity | null>(null)
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<{ changes: InjuryChange[]; lines: PreviewLine[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  function reset() {
    setOpen(false)
    setPart(null)
    setSeverity(null)
    setNote('')
    setPreview(null)
  }

  async function runPreview() {
    if (!part || !severity) return
    setBusy(true)
    setMessage(null)
    try {
      const { changes, preview: lines } = await previewInjury(part, severity, block, plans, injuries)
      setPreview({ changes, lines })
    } catch (err) {
      setMessage(t.injuries.failed(String(err)))
    } finally {
      setBusy(false)
    }
  }

  async function apply() {
    if (!part || !severity || !preview) return
    setBusy(true)
    try {
      await reportInjury(part, severity, note, preview.changes)
      setMessage(t.injuries.applied(preview.lines.length))
      reset()
      onChanged()
      refreshCoach().then(onChanged)
    } catch (err) {
      setMessage(t.injuries.failed(String(err)))
    } finally {
      setBusy(false)
    }
  }

  async function heal(injury: Injury) {
    setBusy(true)
    try {
      await healInjury(injury)
      setMessage(t.injuries.restored)
      onChanged()
      refreshCoach().then(onChanged)
    } catch (err) {
      setMessage(t.injuries.failed(String(err)))
    } finally {
      setBusy(false)
    }
  }

  const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'short' })

  return (
    <section className="gym-day injury-card">
      <h2>
        {t.injuries.title}
        <span className="routine-progress">{t.injuries.sub}</span>
      </h2>

      {injuries.map((injury) => (
        <div key={injury.id} className="injury-row">
          <div className="injury-info">
            <strong>
              {t.injuries.activeLine(t.injuries.parts[injury.body_part], t.injuries.severities[injury.severity], fmtDate(injury.started_on))}
            </strong>
            {setsTouched(injury.changes) > 0 && <span className="gentle">{t.injuries.adjusted(setsTouched(injury.changes))}</span>}
            {injury.note && <span className="injury-note">{injury.note}</span>}
          </div>
          <ConfirmButton
            className="energy-btn"
            label={t.injuries.healed}
            confirmLabel={t.injuries.healedConfirm}
            title={t.injuries.healedTitle}
            onConfirm={() => heal(injury)}
          />
        </div>
      ))}

      {message && <p className="gentle injury-message">{message}</p>}

      {!open ? (
        <button className="energy-btn injury-open" onClick={() => { setOpen(true); setMessage(null) }} disabled={busy}>
          <Icon name="shield" /> {t.injuries.report}
        </button>
      ) : (
        <div className="injury-form">
          <p className="energy-label">{t.injuries.whereQ}</p>
          <div className="energy-row injury-pills">
            {BODY_PARTS.map((p) => (
              <button
                key={p}
                className={part === p ? 'energy-btn active' : 'energy-btn'}
                aria-pressed={part === p}
                onClick={() => { setPart(p); setPreview(null) }}
              >
                {t.injuries.parts[p]}
              </button>
            ))}
          </div>
          <p className="energy-label">{t.injuries.severityQ}</p>
          <div className="energy-row injury-pills">
            {SEVERITIES.map((s) => (
              <button
                key={s}
                className={severity === s ? 'energy-btn active' : 'energy-btn'}
                aria-pressed={severity === s}
                onClick={() => { setSeverity(s); setPreview(null) }}
              >
                {t.injuries.severities[s]}
              </button>
            ))}
          </div>
          {severity && <p className="gentle">{t.injuries.severityHints[severity]}</p>}
          <input
            className="injury-note-input"
            value={note}
            maxLength={MAX_LEN.note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.injuries.notePh}
          />

          {preview && (
            <div className="injury-preview">
              {!block ? (
                <p className="gentle">{t.injuries.noBlock}</p>
              ) : preview.lines.length === 0 ? (
                <p className="gentle">{t.injuries.nothingChanges}</p>
              ) : (
                <>
                  <p className="energy-label">{t.injuries.previewTitle(preview.lines.length)}</p>
                  <ul>
                    {preview.lines.map((line, i) => (
                      <li key={i} className={`injury-line ${line.treatment}`}>
                        {previewText(line)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <div className="energy-row">
            {preview ? (
              <button className="save" onClick={apply} disabled={busy}>
                {preview.changes.length > 0 ? t.injuries.apply : t.injuries.save}
              </button>
            ) : (
              <button className="save" onClick={runPreview} disabled={busy || !part || !severity}>
                {t.injuries.preview}
              </button>
            )}
            <button className="energy-btn" onClick={reset} disabled={busy}>
              {t.common.cancel}
            </button>
          </div>
        </div>
      )}

      <p className="gentle injury-disclaimer">{t.injuries.disclaimer}</p>
    </section>
  )
}
