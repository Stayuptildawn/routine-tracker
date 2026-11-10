import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { signOut } from '../lib/session'
import { translateSeededContent } from '../lib/translateContent'
import { saveCardioTracking, useCardioTracking } from '../lib/cardioTracking'
import { getNudgeState, enableNudges, disableNudges } from '../lib/push'
import { exportCardioLogs, exportCheckins, exportReminders, exportTaskLogs, exportTrainingSets, exportWorkoutLogs } from '../lib/csv'
import { t, locale, lang, availableLanguages, setLanguage } from '../i18n'
import { Button, Dialog, Notice, Segmented, Sheet } from '../components/ui'
import type { ChoiceOption } from '../components/ui'
import InstallSection from './InstallSection'

export type Theme = 'auto' | 'light' | 'dark'

interface Props {
  theme: Theme
  onTheme: (t: Theme) => void
  onClose: () => void
  /** true while the exit transition plays (usePresence in the parent) */
  closing?: boolean
}

const THEME_OPTIONS: ChoiceOption<Theme>[] = [
  { value: 'auto', label: t.settings.themeAuto, icon: 'circle-half' },
  { value: 'light', label: t.settings.themeLight, icon: 'sun' },
  { value: 'dark', label: t.settings.themeDark, icon: 'moon' },
]

const ON_OFF: ChoiceOption<boolean>[] = [
  { value: true, label: t.settings.cardioOn },
  { value: false, label: t.settings.cardioOff },
]

const FALLBACK_ZONES = [
  'UTC',
  'Europe/Madrid',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Los_Angeles',
  'Asia/Tehran',
  'Asia/Tokyo',
]

export default function Settings({ theme, onTheme, onClose, closing }: Props) {
  const deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone
  const zones: string[] =
    (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ??
    FALLBACK_ZONES
  const [tz, setTz] = useState('')
  const [tzSaved, setTzSaved] = useState<boolean | null>(null) // null = loading
  const [email, setEmail] = useState('')
  const [createdAt, setCreatedAt] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const [translating, setTranslating] = useState(false)
  const [translated, setTranslated] = useState<number | null>(null)
  // language is a draft: nothing changes until Save (a switch reloads the
  // app, so an accidental tap must never fire it)
  const [langDraft, setLangDraft] = useState(lang)
  const cardioOn = useCardioTracking()
  // push nudges: 'unsupported' (no push here, or the demo) hides the switch
  const [nudges, setNudges] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown')
  const [nudgesBlocked, setNudgesBlocked] = useState(false)
  // set by Save just before the reload: the reopened Settings offers - once -
  // to also translate the seeded content into the fresh language
  const [offerTranslate, setOfferTranslate] = useState(() => sessionStorage.getItem('offer-translate') === '1')
  useEffect(() => {
    sessionStorage.removeItem('offer-translate')
  }, [])

  useEffect(() => {
    supabase
      .from('user_settings')
      .select('timezone')
      .maybeSingle()
      .then(({ data }) => {
        setTz(data?.timezone ?? deviceTz)
        setTzSaved(!!data?.timezone)
      })
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? '')
      setCreatedAt(data.user?.created_at ?? '')
    })
    getNudgeState().then(setNudges)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTz(value: string) {
    setTz(value)
    setTzSaved(true)
    await supabase
      .from('user_settings')
      .upsert({ timezone: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  }

  async function switchNudges(on: boolean) {
    setNudgesBlocked(false)
    if (on) {
      const result = await enableNudges()
      if (result === 'on') setNudges('on')
      else if (result === 'denied') setNudgesBlocked(true)
    } else {
      await disableNudges()
      setNudges('off')
    }
  }

  async function savePassword() {
    if (pw.length < 6) {
      setPwMsg(t.settings.pwTooShort)
      return
    }
    if (pw !== pw2) {
      setPwMsg(t.settings.pwMismatch)
      return
    }
    setPwBusy(true)
    setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwBusy(false)
    setPw('')
    setPw2('')
    setPwMsg(error ? error.message : t.settings.pwSaved)
  }

  async function saveLanguage() {
    // come back to Settings after the reload, not the Today tab - and offer
    // the content translation there, once
    sessionStorage.setItem('reopen-settings', '1')
    sessionStorage.setItem('offer-translate', '1')
    // the server needs to know too: the weekly reflection is written in this
    // language and nudges use its strings
    await supabase
      .from('user_settings')
      .upsert({ language: langDraft, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
      .then(
        () => {},
        () => {}, // offline: the UI still switches
      )
    setLanguage(langDraft)
  }

  const exports: [string, () => void][] = [
    [t.reflect.csvTasks, exportTaskLogs],
    [t.reflect.csvWorkouts, exportWorkoutLogs],
    ...(cardioOn ? ([[t.reflect.csvCardio, exportCardioLogs]] as [string, () => void][]) : []),
    [t.reflect.csvTraining, exportTrainingSets],
    [t.reflect.csvCheckins, exportCheckins],
    [t.reflect.csvReminders, exportReminders],
  ]

  return (
    <Sheet title={t.settings.title} label={t.settings.title} onClose={onClose} closeLabel={t.settings.close} closing={closing}>
      <div className="sheet__body settings">
        <section className="settings__section">
          <h2>{t.settings.theme}</h2>
          <Segmented options={THEME_OPTIONS} value={theme} onChange={onTheme} label={t.settings.theme} />
          <p className="hint">{t.settings.autoFollows}</p>
        </section>

        {availableLanguages.length > 1 && (
          <section className="settings__section">
            <h2>{t.settings.language}</h2>
            <select value={langDraft} aria-label={t.settings.language} onChange={(e) => setLangDraft(e.target.value)}>
              {availableLanguages.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
            {langDraft !== lang && (
              <div className="actions">
                <Button variant="primary" onClick={saveLanguage}>
                  {t.common.save}
                </Button>
                <Button variant="ghost" onClick={() => setLangDraft(lang)}>
                  {t.common.cancel}
                </Button>
              </div>
            )}
          </section>
        )}

        <section className="settings__section">
          <h2>{t.settings.notifications}</h2>
          {(nudges === 'on' || nudges === 'off') && (
            <div className="field field--inline">
              <span className="field__label settings__grow">{nudges === 'on' ? t.now.nudgesOn : t.now.enableNudges}</span>
              <Segmented className="seg--inline" options={ON_OFF} value={nudges === 'on'} onChange={switchNudges} label={t.settings.notifications} />
            </div>
          )}
          {nudgesBlocked && <Notice tone="warn">{t.now.notifBlocked}</Notice>}
          <div className="field">
            <label className="field__label" htmlFor="settings-tz">
              {t.settings.timezone}
            </label>
            {tzSaved === null ? (
              <p className="hint">{t.common.loading}</p>
            ) : (
              <>
                <select id="settings-tz" value={tz} onChange={(e) => saveTz(e.target.value)}>
                  {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <p className="hint">
                  {t.settings.tzNote}
                  {!tzSaved && t.settings.tzNotSaved(deviceTz)}
                  {tzSaved && t.settings.tzSaved}
                </p>
                {!tzSaved && <Button onClick={() => saveTz(deviceTz)}>{t.settings.useDeviceTz(deviceTz)}</Button>}
              </>
            )}
          </div>
        </section>

        <section className="settings__section">
          <h2>{t.settings.cardioTracking}</h2>
          <Segmented className="seg--inline" options={ON_OFF} value={cardioOn} onChange={saveCardioTracking} label={t.settings.cardioTracking} />
          <p className="hint">{t.settings.cardioHint}</p>
        </section>

        <InstallSection />

        <section className="settings__section">
          <h2>{t.settings.data}</h2>
          <p className="hint">{t.reflect.dataYours}</p>
          <div className="cluster">
            {exports.map(([label, run]) => (
              <Button key={label} size="sm" icon="download" onClick={() => run()}>
                {label}
              </Button>
            ))}
          </div>
        </section>

        <section className="settings__section">
          <h2>{t.settings.account}</h2>
          <dl className="settings__facts">
            <dt>{t.settings.email}</dt>
            <dd>{email || '…'}</dd>
            {createdAt && (
              <>
                <dt>{t.settings.memberSince}</dt>
                <dd>{new Date(createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
              </>
            )}
          </dl>

          <input
            type="password"
            placeholder={t.settings.newPasswordPh}
            aria-label={t.settings.newPasswordPh}
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            minLength={6}
            autoComplete="new-password"
          />
          <input
            type="password"
            placeholder={t.settings.repeatPasswordPh}
            aria-label={t.settings.repeatPasswordPh}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            minLength={6}
            autoComplete="new-password"
            onKeyDown={(e) => e.key === 'Enter' && savePassword()}
          />
          <Button busy={pwBusy} onClick={savePassword} disabled={pw.length < 6 || pw !== pw2}>
            {t.settings.savePassword}
          </Button>
          <p className="hint" role="status">
            {pwMsg ?? (pw && pw2 && pw !== pw2 ? t.settings.pwMismatchYet : t.settings.invitedNote)}
          </p>

          {confirmSignOut ? (
            <div className="stack stack--tight">
              <p className="hint">{t.settings.signOutQ(email)}</p>
              <div className="actions">
                <Button variant="danger" onClick={signOut}>
                  {t.settings.yesSignOut}
                </Button>
                <Button variant="ghost" onClick={() => setConfirmSignOut(false)}>
                  {t.common.cancel}
                </Button>
              </div>
            </div>
          ) : (
            <Button onClick={() => setConfirmSignOut(true)}>{t.settings.signOut}</Button>
          )}
        </section>

        <section className="settings__section">
          <h2>{t.settings.about}</h2>
          <p className="hint">
            {t.settings.aboutBeforeLicense}
            <a href="https://github.com/Stayuptildawn/routine-tracker/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
              AGPL-3.0
            </a>
            {t.settings.aboutAfterLicense}
          </p>
          <a href="https://github.com/Stayuptildawn/routine-tracker" target="_blank" rel="noopener noreferrer">
            {t.settings.sourceCode}
          </a>
        </section>
      </div>

      {offerTranslate && (
        <Dialog title={t.settings.translateContent} onClose={() => !translating && setOfferTranslate(false)}>
          <p className="hint">{translated !== null ? t.settings.translateContentDone(translated) : t.settings.translateContentNote}</p>
          {translated === null ? (
            <div className="actions">
              <Button
                variant="primary"
                busy={translating}
                onClick={async () => {
                  setTranslating(true)
                  try {
                    setTranslated(await translateSeededContent(lang))
                  } finally {
                    setTranslating(false)
                  }
                }}
              >
                {t.settings.translateNow}
              </Button>
              <Button variant="ghost" onClick={() => setOfferTranslate(false)} disabled={translating}>
                {t.settings.translateSkip}
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setOfferTranslate(false)}>
              {t.common.close}
            </Button>
          )}
        </Dialog>
      )}
    </Sheet>
  )
}
