import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { enterDemo } from '../lib/demo'
import { t } from '../i18n'
import InstallPrompt from './InstallPrompt'
import { Button, Notice } from '../components/ui'

type Mode = 'signin' | 'signup' | 'reset'

// A ?code= that reached the sign-in screen is an email link opened in a
// browser that didn't ask for it (PKCE keeps the verifier where the request
// was made). Note it once and tidy the URL.
const strayEmailLink = new URLSearchParams(location.search).has('code')
if (strayEmailLink) {
  const url = new URL(location.href)
  url.searchParams.delete('code')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

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

  function switchMode(next: Mode) {
    setMode(next)
    setError(null)
    setSent(false)
  }

  return (
    <div className="auth">
      <h1>{t.auth.title}</h1>
      <InstallPrompt />
      <form className="stack" onSubmit={submit}>
        <input
          type="email"
          placeholder={t.auth.emailPh}
          aria-label={t.auth.emailPh}
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        {mode !== 'reset' && (
          <input
            type="password"
            placeholder={t.auth.passwordPh}
            aria-label={t.auth.passwordPh}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        )}
        <Button type="submit" variant="primary" block busy={busy}>
          {mode === 'signin' ? t.auth.signIn : mode === 'signup' ? t.auth.createAccount : t.auth.sendResetLink}
        </Button>
      </form>

      {sent && mode === 'reset' && <Notice tone="good">{t.auth.resetSent}</Notice>}
      {sent && mode === 'signup' && <Notice tone="good">{t.auth.confirmSent}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      {strayEmailLink && !sent && !error && <Notice>{t.auth.linkOtherBrowser}</Notice>}

      <div className="stack stack--tight auth__links">
        {mode === 'signin' && (
          <Button variant="ghost" size="sm" onClick={() => switchMode('reset')}>
            {t.auth.forgotPassword}
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={() => switchMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? t.auth.toSignUp : t.auth.toSignIn}
        </Button>
        <Button variant="ghost" size="sm" onClick={enterDemo}>
          {t.demo.tryDemo}
        </Button>
      </div>
    </div>
  )
}
