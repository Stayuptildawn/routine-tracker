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

  return (
    <div className="install-card">
      <p className="install-title"><Icon name="install" /> {t.install.installFirst}</p>

      {platform === 'ios' ? (
        <>
          <p className="install-body">{t.install.iosBody}</p>
          <button className="link install-later" onClick={dismiss}>
            {t.install.maybeLater}
          </button>
        </>
      ) : canPrompt ? (
        // Android with Chrome's install event ready: one tap does it.
        <>
          <p className="install-body">{t.install.androidOneTapBody}</p>
          <div className="install-actions">
            <button className="start-session" onClick={install}>
              {t.install.installApp}
            </button>
            <button className="link install-later" onClick={dismiss}>
              {t.install.maybeLater}
            </button>
          </div>
        </>
      ) : (
        // Android without the event (Firefox, Samsung Internet, or Chrome
        // before it offers the prompt): tell them where the menu item lives.
        <>
          <p className="install-body">{t.install.androidMenuBody}</p>
          <button className="link install-later" onClick={dismiss}>
            {t.install.maybeLater}
          </button>
        </>
      )}
    </div>
  )
}
