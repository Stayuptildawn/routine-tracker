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
import { Button, Card, Chips, Notice } from '../components/ui'

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
    <Card title={t.injuries.title} meta={t.injuries.sub}>
      {injuries.length > 0 && (
        <div className="rows">
          {injuries.map((injury) => (
            <div key={injury.id} className="row">
              <div className="row__main">
                <strong>
                  {t.injuries.activeLine(t.injuries.parts[injury.body_part], t.injuries.severities[injury.severity], fmtDate(injury.started_on))}
                </strong>
                {setsTouched(injury.changes) > 0 && <p className="hint">{t.injuries.adjusted(setsTouched(injury.changes))}</p>}
                {injury.note && <p className="hint">{injury.note}</p>}
              </div>
              <ConfirmButton
                variant="secondary"
                size="sm"
                label={t.injuries.healed}
                confirmLabel={t.injuries.healedConfirm}
                title={t.injuries.healedTitle}
                onConfirm={() => heal(injury)}
              />
            </div>
          ))}
        </div>
      )}

      {message && <Notice onDismiss={() => setMessage(null)}>{message}</Notice>}

      {!open ? (
        <Button
          icon="shield"
          className="injury__open"
          onClick={() => {
            setOpen(true)
            setMessage(null)
          }}
          disabled={busy}
        >
          {t.injuries.report}
        </Button>
      ) : (
        <div className="stack">
          <div className="field">
            <span className="field__label">{t.injuries.whereQ}</span>
            <Chips
              label={t.injuries.whereQ}
              value={part}
              onChange={(p) => {
                setPart(p)
                setPreview(null)
              }}
              options={BODY_PARTS.map((p) => ({ value: p, label: t.injuries.parts[p] }))}
            />
          </div>
          <div className="field">
            <span className="field__label">{t.injuries.severityQ}</span>
            <Chips
              label={t.injuries.severityQ}
              value={severity}
              onChange={(s) => {
                setSeverity(s)
                setPreview(null)
              }}
              options={SEVERITIES.map((s) => ({ value: s, label: t.injuries.severities[s] }))}
            />
            {severity && <p className="hint">{t.injuries.severityHints[severity]}</p>}
          </div>
          <input
            value={note}
            maxLength={MAX_LEN.note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t.injuries.notePh}
            aria-label={t.injuries.notePh}
          />

          {preview &&
            (!block ? (
              <p className="hint">{t.injuries.noBlock}</p>
            ) : preview.lines.length === 0 ? (
              <p className="hint">{t.injuries.nothingChanges}</p>
            ) : (
              <div className="stack stack--tight">
                <p className="field__label">{t.injuries.previewTitle(preview.lines.length)}</p>
                <ul className="injury__preview">
                  {preview.lines.map((line, i) => (
                    <li key={i}>{previewText(line)}</li>
                  ))}
                </ul>
              </div>
            ))}

          <div className="actions">
            {preview ? (
              <Button variant="primary" busy={busy} onClick={apply}>
                {preview.changes.length > 0 ? t.injuries.apply : t.injuries.save}
              </Button>
            ) : (
              <Button variant="primary" busy={busy} onClick={runPreview} disabled={!part || !severity}>
                {t.injuries.preview}
              </Button>
            )}
            <Button variant="ghost" onClick={reset} disabled={busy}>
              {t.common.cancel}
            </Button>
          </div>
        </div>
      )}

      <p className="hint">{t.injuries.disclaimer}</p>
    </Card>
  )
}
