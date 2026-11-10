import { useState, useSyncExternalStore } from 'react'
import {
  ANDROID_INSTALL_STEPS,
  detectPlatform,
  hasDeferredPrompt,
  IOS_INSTALL_STEPS,
  isStandalone,
  subscribeInstall,
  triggerInstall,
} from '../lib/pwaInstall'
import { t } from '../i18n'
import { Button } from '../components/ui'

// The Settings entry for installing the app, for signed-in mobile users who
// skipped (or never saw) the prompt on the sign-in screen. On Android with
// Chrome's install event captured, one tap installs; otherwise - including
// every iOS browser - the steps are spelled out, since there is nothing to fire.
export default function InstallSection() {
  const platform = detectPlatform()
  const canPrompt = useSyncExternalStore(subscribeInstall, hasDeferredPrompt)
  const [installed, setInstalled] = useState(false)

  // Desktop uses the browser, and an installed app doesn't need this.
  if (platform === 'other' || isStandalone() || installed) return null

  async function install() {
    const outcome = await triggerInstall()
    if (outcome === 'accepted') setInstalled(true)
  }

  return (
    <section className="settings__section">
      <h2>{t.install.installApp}</h2>
      {canPrompt ? (
        <>
          <p className="hint">{t.install.androidOneTapBody}</p>
          <Button icon="install" onClick={install}>
            {t.install.installApp}
          </Button>
        </>
      ) : (
        <p className="hint">
          {platform === 'ios' ? IOS_INSTALL_STEPS : ANDROID_INSTALL_STEPS}
          {t.install.helpTail}
        </p>
      )}
    </section>
  )
}
