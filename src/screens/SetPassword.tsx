import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { t } from '../i18n'

// Shown when someone arrives via a recovery/invite link with a session but
// no usable password. They set one here (typed twice), then land in the app.
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 6) {
      setError(t.setPassword.tooShort)
      return
    }
    if (pw !== pw2) {
      setError(t.setPassword.mismatch)
      return
    }
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <div className="auth">
      <h1>{t.setPassword.title}</h1>
      <p className="gentle">{t.setPassword.subtitle}</p>
      <form onSubmit={submit}>
        <input
          type="password"
          placeholder={t.setPassword.newPasswordPh}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={6}
          autoFocus
        />
        <input
          type="password"
          placeholder={t.setPassword.repeatPasswordPh}
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          required
          minLength={6}
        />
        <button type="submit" disabled={busy || pw.length < 6 || pw !== pw2}>
          {busy ? '…' : t.setPassword.submit}
        </button>
      </form>
      {error && <div className="notice">{error}</div>}
    </div>
  )
}
