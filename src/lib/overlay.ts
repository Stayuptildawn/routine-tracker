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

/** Everything a full-screen dialog needs to behave like one: focus stays
 *  trapped inside (and returns to the opener on close), and both Escape and
 *  the installed-PWA back button call onClose. Attach the returned ref to the
 *  dialog's root element; onClose may change between renders. */
export function useOverlay<T extends HTMLElement>(onClose: () => void) {
  const ref = useFocusTrap<T>()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

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
