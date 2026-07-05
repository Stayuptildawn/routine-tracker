import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Shown when someone arrives via a recovery/invite link with a session but
// no usable password. They set one here, then land in the app normally.
export default function SetPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (pw.length < 6) {
      setError('Use at least 6 characters.')
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
      <h1>Set a password</h1>
      <p className="gentle">Pick a password so you can sign in next time.</p>
      <form onSubmit={submit}>
        <input
          type="password"
          placeholder="New password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          required
          minLength={6}
          autoFocus
        />
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Set password'}
        </button>
      </form>
      {error && <div className="notice">{error}</div>}
    </div>
  )
}
