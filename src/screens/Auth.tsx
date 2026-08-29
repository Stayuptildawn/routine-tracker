import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { enterDemo } from '../lib/demo'
import { t } from '../i18n'
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
    const { data, error } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password })
    if (error) setError(error.message)
    // signUp with email confirmation on returns neither session nor error -
    // without this the form just sits there after the user's first action
    else if (mode === 'signup' && !data.session) setSent(true)
    setBusy(false)
  }

  return (
    <div className="auth">
      <h1>{t.auth.title}</h1>
      <InstallPrompt />
      <form onSubmit={submit}>
        <input
          type="email"
          placeholder={t.auth.emailPh}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'reset' && (
          <input
            type="password"
            placeholder={t.auth.passwordPh}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        )}
        <button type="submit" disabled={busy}>
          {mode === 'signin' ? t.auth.signIn : mode === 'signup' ? t.auth.createAccount : t.auth.sendResetLink}
        </button>
      </form>

      {sent && mode === 'reset' && (
        <div className="notice good">{t.auth.resetSent}</div>
      )}
      {sent && mode === 'signup' && (
        <div className="notice good">{t.auth.confirmSent}</div>
      )}
      {error && <div className="notice">{error}</div>}

      {mode === 'signin' && (
        <button className="link" onClick={() => { setMode('reset'); setError(null); setSent(false) }}>
          {t.auth.forgotPassword}
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
        {mode === 'signin' ? t.auth.toSignUp : t.auth.toSignIn}
      </button>
      <button className="link demo-link" onClick={enterDemo}>
        {t.demo.tryDemo}
      </button>
    </div>
  )
}
