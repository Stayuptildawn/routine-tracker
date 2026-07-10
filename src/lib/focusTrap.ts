import { useEffect, useRef } from 'react'

/** Keeps keyboard focus inside a full-screen dialog: focuses the first
 *  control on mount, wraps Tab/Shift+Tab at the edges, and hands focus back
 *  to wherever it was when the dialog closes. Attach the returned ref to the
 *  dialog's root element. */
export function useFocusTrap<T extends HTMLElement>() {
  const ref = useRef<T>(null)

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const opener = document.activeElement as HTMLElement | null
    const focusables = () =>
      [...root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )].filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null)

    focusables()[0]?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const els = focusables()
      if (els.length === 0) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    root.addEventListener('keydown', onKey)
    return () => {
      root.removeEventListener('keydown', onKey)
      opener?.focus()
    }
  }, [])

  return ref
}
