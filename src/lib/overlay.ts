import { useEffect, useRef, useState } from 'react'
import { onBackButton } from './backButton'
import { useFocusTrap } from './focusTrap'

/** How long exiting overlays stay mounted so their CSS exit transition can
 *  play — must cover --speed-exit in index.css. */
export const EXIT_MS = 180

/** Presence with an exit phase: `mounted` lags `open` by EXIT_MS on close.
 *  Render the element while `mounted`, and give it data-closing while
 *  `closing` so the stylesheet can transition it out before unmount. */
export function usePresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  if (open && !mounted) setMounted(true)
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setMounted(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open])
  return { mounted, closing: mounted && !open }
}

// open overlays holding the page still - the first one locks, the last unlocks
let locks = 0
let lockedY = 0

/** Pins the page under a dialog. iOS bug: focusing an input inside a
 *  position:fixed layer makes WebKit scroll the DOCUMENT to reveal it, which
 *  can never succeed - so it keeps scrolling the page behind the overlay
 *  until the app locks up. A fixed body has nothing left to scroll. */
export function useScrollLock() {
  useEffect(() => {
    if (locks++ === 0) {
      lockedY = window.scrollY
      pin()
    }
    return () => {
      if (--locks > 0) return
      unpin()
      window.scrollTo(0, lockedY)
    }
  }, [])
}

function pin() {
  const s = document.body.style
  s.position = 'fixed'
  s.top = `-${lockedY}px`
  s.left = '0'
  s.right = '0'
}

function unpin() {
  const s = document.body.style
  s.position = ''
  s.top = ''
  s.left = ''
  s.right = ''
}

/** Re-anchor fixed layout while a dialog holds the page. A pinned body has
 *  nothing to scroll, so the usual 1px nudge does nothing and iOS keeps the
 *  stale viewport pan from before a rotation - taps then land off from where
 *  things are drawn. Unpin, nudge the real document, pin again (all in one
 *  task, so nothing flashes). Returns false when no dialog is open. */
export function reanchorLocked() {
  if (locks === 0) return false
  unpin()
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  lockedY = Math.min(lockedY, max)
  window.scrollTo(0, lockedY > 0 ? lockedY - 1 : lockedY + 1)
  window.scrollTo(0, lockedY)
  pin()
  return true
}

/** Everything a full-screen dialog needs to behave like one: focus stays
 *  trapped inside (and returns to the opener on close), the page behind it
 *  can't scroll, and both Escape and the installed-PWA back button call
 *  onClose. Attach the returned ref to the dialog's root element; onClose may
 *  change between renders. */
export function useOverlay<T extends HTMLElement>(onClose: () => void) {
  const ref = useFocusTrap<T>()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useScrollLock()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    const unregister = onBackButton(() => {
      closeRef.current()
      return true
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      unregister()
    }
  }, [])

  return ref
}
