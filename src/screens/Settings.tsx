import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useOverlay } from '../lib/overlay'
import { translateSeededContent } from '../lib/translateContent'
import { t, locale, lang, availableLanguages, setLanguage } from '../i18n'
import Icon from '../components/Icon'
import type { IconName } from '../components/Icon'

export type Theme = 'auto' | 'light' | 'dark'

interface Props {
  theme: Theme
  onTheme: (t: Theme) => void
  onClose: () => void
  /** true while the exit transition plays (usePresence in the parent) */
  closing?: boolean
}

const THEME_OPTIONS: [Theme, IconName, string][] = [
  ['auto', 'circle-half', t.settings.themeAuto],
  ['light', 'sun', t.settings.themeLight],
  ['dark', 'moon', t.settings.themeDark],
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
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveTz(value: string) {
    setTz(value)
    setTzSaved(true)
    await supabase
      .from('user_settings')
      .upsert({ timezone: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
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

  // Escape and the installed-PWA back button close Settings like the close link
  const trapRef = useOverlay<HTMLDivElement>(onClose)

  return (
    <div
      ref={trapRef}
      className="player settings-screen"
      data-closing={closing || undefined}
      role="dialog"
      aria-modal="true"
      aria-label={t.settings.title}
    >
      <div className="player-inner">
        <div className="player-top">
          <span className="eyebrow">{t.settings.title}</span>
          <button className="link" onClick={onClose}>
            {t.settings.close}
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h2>{t.settings.theme}</h2>
            <div className="energy-row">
              {THEME_OPTIONS.map(([value, icon, label]) => (
                <button
                  key={value}
                  className={theme === value ? 'energy-btn active' : 'energy-btn'}
                  aria-pressed={theme === value}
                  onClick={() => onTheme(value)}
                >
                  <Icon name={icon} /> {label}
                </button>
              ))}
            </div>
            <p className="gentle">{t.settings.autoFollows}</p>
          </section>

          {availableLanguages.length > 1 && (
            <section className="settings-section">
              <h2>{t.settings.language}</h2>
              <select className="settings-tz" value={langDraft} onChange={(e) => setLangDraft(e.target.value)}>
                {availableLanguages.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
              {langDraft !== lang && (
                <div className="sign-out-actions lang-save-row">
                  <button
                    className="save"
                    onClick={async () => {
                      // come back to Settings after the reload, not the Now
                      // tab - and offer the content translation there, once
                      sessionStorage.setItem('reopen-settings', '1')
                      sessionStorage.setItem('offer-translate', '1')
                      // the server needs to know too: the weekly reflection is
                      // written in this language and nudges use its strings
                      await supabase
                        .from('user_settings')
                        .upsert({ language: langDraft, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
                        .then(() => {}, () => {}) // offline: the UI still switches
                      setLanguage(langDraft)
                    }}
                  >
                    {t.common.save}
                  </button>
                  <button className="energy-btn" onClick={() => setLangDraft(lang)}>
                    {t.common.cancel}
                  </button>
                </div>
              )}
            </section>
          )}

          <section className="settings-section">
            <h2>{t.settings.timezone}</h2>
            {tzSaved === null ? (
              <p className="gentle">{t.common.loading}</p>
            ) : (
              <>
                <select className="settings-tz" value={tz} onChange={(e) => saveTz(e.target.value)}>
                  {(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => (
                    <option key={z} value={z}>
                      {z}
                    </option>
                  ))}
                </select>
                <p className="gentle">
                  {t.settings.tzNote}
                  {!tzSaved && t.settings.tzNotSaved(deviceTz)}
                  {tzSaved && t.settings.tzSaved}
                </p>
                {!tzSaved && (
                  <button className="start-session" onClick={() => saveTz(deviceTz)}>
                    {t.settings.useDeviceTz(deviceTz)}
                  </button>
                )}
              </>
            )}
          </section>

          <section className="settings-section">
            <h2>{t.settings.account}</h2>
            <dl className="account-info">
              <dt>{t.settings.email}</dt>
              <dd>{email || '…'}</dd>
              {createdAt && (
                <>
                  <dt>{t.settings.memberSince}</dt>
                  <dd>{new Date(createdAt).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
                </>
              )}
            </dl>

            <div className="settings-pw">
              <input
                type="password"
                placeholder={t.settings.newPasswordPh}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
              <input
                type="password"
                placeholder={t.settings.repeatPasswordPh}
                value={pw2}
                onChange={(e) => setPw2(e.target.value)}
                minLength={6}
                autoComplete="new-password"
                onKeyDown={(e) => e.key === 'Enter' && savePassword()}
              />
              <button
                className="start-session"
                onClick={savePassword}
                disabled={pwBusy || pw.length < 6 || pw !== pw2}
              >
                {pwBusy ? '…' : t.settings.savePassword}
              </button>
            </div>
            <p className="gentle">
              {pwMsg ??
                (pw && pw2 && pw !== pw2
                  ? t.settings.pwMismatchYet
                  : t.settings.invitedNote)}
            </p>

            {confirmSignOut ? (
              <div className="sign-out-confirm">
                <p className="gentle">{t.settings.signOutQ(email)}</p>
                <div className="sign-out-actions">
                  <button className="sign-out" onClick={() => supabase.auth.signOut()}>
                    {t.settings.yesSignOut}
                  </button>
                  <button className="link" onClick={() => setConfirmSignOut(false)}>
                    {t.common.cancel}
                  </button>
                </div>
              </div>
            ) : (
              <button className="sign-out" onClick={() => setConfirmSignOut(true)}>
                {t.settings.signOut}
              </button>
            )}
          </section>

          <section className="settings-section">
            <h2>{t.settings.about}</h2>
            <p className="gentle">
              {t.settings.aboutBeforeLicense}
              <a
                className="text-link"
                href="https://github.com/Stayuptildawn/routine-tracker/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
              >
                AGPL-3.0
              </a>
              {t.settings.aboutAfterLicense}
            </p>
            <a
              className="text-link"
              href="https://github.com/Stayuptildawn/routine-tracker"
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.settings.sourceCode}
            </a>
          </section>
        </div>
      </div>

      {offerTranslate && (
        <div className="install-help-backdrop" onClick={() => !translating && setOfferTranslate(false)}>
          <div
            className="install-help"
            role="dialog"
            aria-label={t.settings.translateContent}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="install-title">{t.settings.translateContent}</p>
            <p className="install-body">
              {translated !== null ? t.settings.translateContentDone(translated) : t.settings.translateContentNote}
            </p>
            {translated === null ? (
              <div className="install-actions">
                <button
                  className="start-session"
                  disabled={translating}
                  onClick={async () => {
                    setTranslating(true)
                    try {
                      setTranslated(await translateSeededContent(lang))
                    } finally {
                      setTranslating(false)
                    }
                  }}
                >
                  {translating ? '…' : t.settings.translateNow}
                </button>
                <button className="link install-later" onClick={() => setOfferTranslate(false)}>
                  {t.settings.translateSkip}
                </button>
              </div>
            ) : (
              <button className="start-session" onClick={() => setOfferTranslate(false)}>
                {t.common.close}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
