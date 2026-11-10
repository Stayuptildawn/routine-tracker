import { useState, useSyncExternalStore } from 'react'
import {
  detectPlatform,
  hasDeferredPrompt,
  isStandalone,
  subscribeInstall,
  triggerInstall,
} from '../lib/pwaInstall'
import { t } from '../i18n'
import Icon from '../components/Icon'
import { Button } from '../components/ui'

const DISMISS_KEY = 'pwa-install-dismissed'

// Nudges mobile visitors to install the PWA before they sign in. Most people
// don't know a web app can live on the home screen, and it runs much better
// there (full screen, push nudges, share target).
export default function InstallPrompt() {
  const platform = detectPlatform()
  const canPrompt = useSyncExternalStore(subscribeInstall, hasDeferredPrompt)
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === '1')

  // Desktop can just use the browser, and an installed app never needs this.
  if (platform === 'other' || isStandalone() || dismissed) return null

  function dismiss() {
    localStorage.setItem(DISMISS_KEY, '1')
    setDismissed(true)
  }

  async function install() {
    const outcome = await triggerInstall()
    if (outcome === 'accepted') dismiss()
  }

  const later = (
    <Button variant="ghost" size="sm" onClick={dismiss}>
      {t.install.maybeLater}
    </Button>
  )

  return (
    <section className="card auth__install">
      <h2>
        <Icon name="install" /> {t.install.installFirst}
      </h2>
      {platform === 'ios' ? (
        <>
          <p className="hint">{t.install.iosBody}</p>
          {later}
        </>
      ) : canPrompt ? (
        // Android with Chrome's install event ready: one tap does it.
        <>
          <p className="hint">{t.install.androidOneTapBody}</p>
          <div className="actions">
            <Button variant="primary" onClick={install}>
              {t.install.installApp}
            </Button>
            {later}
          </div>
        </>
      ) : (
        // Android without the event (Firefox, Samsung Internet, or Chrome
        // before it offers the prompt): tell them where the menu item lives.
        <>
          <p className="hint">{t.install.androidMenuBody}</p>
          {later}
        </>
      )}
    </section>
  )
}
