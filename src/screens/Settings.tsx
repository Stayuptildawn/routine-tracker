import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  const [pw, setPw] = useState('')
  const [pwMsg, setPwMsg] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  useEffect(() => {
    supabase
      .from('user_settings')
      .select('timezone')
      .maybeSingle()
      .then(({ data }) => {
        setTz(data?.timezone ?? deviceTz)
        setTzSaved(!!data?.timezone)
      })
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''))
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
    setPwBusy(true)
    setPwMsg(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setPwBusy(false)
    setPw('')
    setPwMsg(error ? error.message : 'Password saved. Use it to sign in next time.')
  }

  return (
    <div className="player settings-screen" role="dialog" aria-label="Settings">
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
            {email && <p className="gentle">Signed in as {email}.</p>}
            <div className="add-task">
              <input
                type="password"
                placeholder="Set or change password"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                minLength={6}
                autoComplete="new-password"
              />
              <button onClick={savePassword} disabled={pwBusy || pw.length < 6}>
                {pwBusy ? '…' : 'Save'}
              </button>
            </div>
            <p className="gentle">
              {pwMsg ?? 'If you were invited by email, set a password here so you can sign back in later.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
