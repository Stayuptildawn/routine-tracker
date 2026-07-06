// Captures Chrome/Android's beforeinstallprompt as early as the module loads,
// so the install button on the Auth screen has an event to fire. iOS has no
// such API (install is a manual "Add to Home Screen"), so we detect the
// platform and show instructions there instead.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault() // keep Chrome's own mini-infobar from showing
  deferred = e as BeforeInstallPromptEvent
  emit()
})
window.addEventListener('appinstalled', () => {
  deferred = null
  emit()
})

export function hasDeferredPrompt() {
  return deferred !== null
}

export function subscribeInstall(fn: () => void) {
  subs.add(fn)
  return () => {
    subs.delete(fn)
  }
}

export async function triggerInstall(): Promise<'accepted' | 'dismissed' | null> {
  if (!deferred) return null
  deferred.prompt()
  const { outcome } = await deferred.userChoice
  deferred = null
  emit()
  return outcome
}

// Manual steps for when there's no install event to fire (always on iOS,
// sometimes on Android). Shared so the login card and the Now-tab button agree.
export const IOS_INSTALL_STEPS =
  'Tap the Share button at the bottom of the screen, then “Add to Home Screen”.'
export const ANDROID_INSTALL_STEPS =
  'Tap the ⋮ menu at the top right of your browser, then “Install app” (some browsers call it “Add to Home screen”).'

export type Platform = 'ios' | 'android' | 'other'

export function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/android/i.test(ua)) return 'android'
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  // iPadOS 13+ reports as a Mac, tell it apart by the touch screen
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  return 'other'
}

export function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}
