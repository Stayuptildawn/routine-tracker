import { useEffect, useRef } from 'react'
import { onBackButton } from './backButton'
import { useFocusTrap } from './focusTrap'

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
