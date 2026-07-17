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
import Icon from '../components/Icon'

// A standing "install this app" button for signed-in mobile users who are
// still in the browser. Android gets the native install dialog when Chrome
// offers it; iOS (and Android browsers without the event) get the manual
// "add to home screen" steps, since there's no install API to call there.
export default function InstallButton() {
  const platform = detectPlatform()
  const canPrompt = useSyncExternalStore(subscribeInstall, hasDeferredPrompt)
  const [installed, setInstalled] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  // Desktop uses the browser, and an installed app doesn't need this.
  if (platform === 'other' || isStandalone() || installed) return null

  async function onClick() {
    if (canPrompt) {
      const outcome = await triggerInstall()
      if (outcome === 'accepted') setInstalled(true)
    } else {
      setShowHelp(true)
    }
  }

  return (
    <>
      <button className="install-fab" onClick={onClick} title={t.install.installApp} aria-label={t.install.installApp}>
        <Icon name="install" /> {t.install.install}
      </button>

      {showHelp && (
        <div className="install-help-backdrop" onClick={() => setShowHelp(false)}>
          <div
            className="install-help"
            role="dialog"
            aria-label={t.install.helpAria}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="install-title"><Icon name="install" /> {t.install.helpTitle}</p>
            <p className="install-body">
              {platform === 'ios' ? IOS_INSTALL_STEPS : ANDROID_INSTALL_STEPS}
              {t.install.helpTail}
            </p>
            <button className="start-session" onClick={() => setShowHelp(false)}>
              {t.install.gotIt}
            </button>
          </div>
        </div>
      )}
    </>
  )
}
