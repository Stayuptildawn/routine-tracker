import { useState } from 'react'
import { supabase } from '../lib/supabase'
import InstallPrompt from './InstallPrompt'

type Mode = 'signin' | 'signup' | 'reset'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<Mode>('signin')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + import.meta.env.BASE_URL,
      })
      if (error) setError(error.message)
      else setSent(true)
      setBusy(false)
      return
    }
    const { error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    setBusy(false)
  }

  return (
    <div className="auth">
      <h1>Routine Tracker</h1>
      <InstallPrompt />
      <form onSubmit={submit}>
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'reset' && (
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        )}
        <button type="submit" disabled={busy}>
          {mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
        </button>
      </form>

      {sent && mode === 'reset' && (
        <div className="notice">Check your email for a link to set a new password.</div>
      )}
      {error && <div className="notice">{error}</div>}

      {mode === 'signin' && (
        <button className="link" onClick={() => { setMode('reset'); setError(null); setSent(false) }}>
          Forgot your password?
        </button>
      )}
      <button
        className="link"
        onClick={() => {
          setMode(mode === 'signin' ? 'signup' : 'signin')
          setError(null)
          setSent(false)
        }}
      >
        {mode === 'signin' ? 'First time? Create an account' : 'Have an account? Sign in'}
      </button>
    </div>
  )
}
