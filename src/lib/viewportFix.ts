// iOS standalone-PWA keyboard bug: opening the on-screen keyboard pans the
// layout viewport up, and closing it sometimes fails to pan it back. Every
// position:fixed element (tab bar, save bar, toasts, overlays) is anchored to
// the layout viewport, so they're left floating mid-screen until the app is
// relaunched. Detecting the keyboard closing via visualViewport and nudging
// the window scroll makes WebKit re-anchor fixed layout.

import { reanchorLocked } from './overlay'

export function armViewportFix() {
  const vv = window.visualViewport
  if (!vv) return

  const reanchor = () => {
    // an open dialog pins the body, which needs its own nudge
    if (reanchorLocked()) return
    const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
    const y = Math.min(window.scrollY, max)
    // a real scroll delta is required - scrollTo(current) is a no-op and
    // leaves the stale pan in place
    window.scrollTo(0, y > 0 ? y - 1 : y + 1)
    window.scrollTo(0, y)
  }

  let keyboardOpen = false
  let settle: ReturnType<typeof setTimeout> | undefined
  vv.addEventListener('resize', () => {
    const open = window.innerHeight - vv.height > 100
    if (keyboardOpen && !open) {
      // wait out the keyboard-hide animation; scrolling mid-animation gets
      // overridden by WebKit's own (sometimes broken) restore
      clearTimeout(settle)
      settle = setTimeout(reanchor, 250)
    }
    keyboardOpen = open
  })

  // rotating leaves the same kind of stale pan behind (worst with a dialog
  // open), so drawn and tappable positions drift apart; re-anchor once the
  // rotation animation has finished
  let lastWidth = window.innerWidth
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastWidth) return
    lastWidth = window.innerWidth
    clearTimeout(settle)
    settle = setTimeout(reanchor, 400)
  })

  // resuming the app can restore a stale pan too (iOS snapshots the old
  // viewport state); re-anchor whenever the app comes back to the foreground
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !keyboardOpen) reanchor()
  })
}
