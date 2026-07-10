import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useFocusTrap } from '../lib/focusTrap'

export type Theme = 'auto' | 'light' | 'dark'

interface Props {
  theme: Theme
  onTheme: (t: Theme) => void
  onClose: () => void
}

const THEME_OPTIONS: [Theme, string][] = [
  ['auto', '🌗 Auto'],
  ['light', '☀️ Light'],
  ['dark', '🌙 Dark'],
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

export default function Settings({ theme, onTheme, onClose }: Props) {
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
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
      setPwMsg('Use at least 6 characters.')
      return
    }
    if (pw !== pw2) {
      setPwMsg('The two passwords don’t match.')
      return
    }
    setPwBusy(true)
    setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwBusy(false)
    setPw('')
    setPw2('')
    setPwMsg(error ? error.message : 'Password saved. Use it to sign in next time.')
  }

  const trapRef = useFocusTrap<HTMLDivElement>()

  return (
    <div ref={trapRef} className="player settings-screen" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="player-inner">
        <div className="player-top">
          <span className="eyebrow">Settings</span>
          <button className="link" onClick={onClose}>
            close
          </button>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h2>Theme</h2>
            <div className="energy-row">
              {THEME_OPTIONS.map(([value, label]) => (
                <button
                  key={value}
                  className={theme === value ? 'energy-btn active' : 'energy-btn'}
                  aria-pressed={theme === value}
                  onClick={() => onTheme(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="gentle">Auto follows your device.</p>
          </section>

          <section className="settings-section">
            <h2>Timezone</h2>
            {tzSaved === null ? (
              <p className="gentle">Loading…</p>
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
                  Used by push nudges, the Sunday reflection and the Telegram bot.
                  {!tzSaved && ` Not saved yet — pick one to confirm (your device says ${deviceTz}).`}
                  {tzSaved && ' Saved.'}
                </p>
                {!tzSaved && (
                  <button className="start-session" onClick={() => saveTz(deviceTz)}>
                    Use my device timezone ({deviceTz})
                  </button>
                )}
              </>
            )}
          </section>

          <section className="settings-section">
            <h2>Account</h2>
            <dl className="account-info">
              <dt>Email</dt>
              <dd>{email || '…'}</dd>
              {createdAt && (
                <>
                  <dt>Member since</dt>
                  <dd>{new Date(createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}</dd>
                </>
              )}
            </dl>

            <div className="settings-pw">
              <input
                type="password"
                placeholder="New password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
              <input
                type="password"
                placeholder="Repeat new password"
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
                {pwBusy ? '…' : 'Save password'}
              </button>
            </div>
            <p className="gentle">
              {pwMsg ??
                (pw && pw2 && pw !== pw2
                  ? 'The two passwords don’t match yet.'
                  : 'If you were invited by email, set a password here so you can sign back in later.')}
            </p>

            {confirmSignOut ? (
              <div className="sign-out-confirm">
                <p className="gentle">Sign out{email ? ` of ${email}` : ''}?</p>
                <div className="sign-out-actions">
                  <button className="sign-out" onClick={() => supabase.auth.signOut()}>
                    Yes, sign out
                  </button>
                  <button className="link" onClick={() => setConfirmSignOut(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button className="sign-out" onClick={() => setConfirmSignOut(true)}>
                Sign out
              </button>
            )}
          </section>

          <section className="settings-section">
            <h2>About</h2>
            <p className="gentle">
              This app is free software under the{' '}
              <a
                className="text-link"
                href="https://github.com/Stayuptildawn/routine-tracker/blob/main/LICENSE"
                target="_blank"
                rel="noopener noreferrer"
              >
                AGPL-3.0
              </a>
              . You’re free to read it, run it and change it — and the full source is right here.
            </p>
            <a
              className="text-link"
              href="https://github.com/Stayuptildawn/routine-tracker"
              target="_blank"
              rel="noopener noreferrer"
            >
              Source code on GitHub →
            </a>
          </section>
        </div>
      </div>
    </div>
  )
}
