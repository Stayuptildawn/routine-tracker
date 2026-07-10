// Hardware/gesture back inside the installed PWA (Android back button, iOS
// edge swipe): close the topmost overlay, else fall back to the Now tab, and
// never leave the app. Browser tabs are untouched - the guard only arms in
// standalone display mode, so the real back button keeps working there.
//
// How it works: a small buffer of sentinel history entries sits on top of the
// real entry. A back press pops one, we handle it and refill the buffer to its
// full depth (the popstate state says which entry we landed on), so even
// spamming back can't run the stack dry and close the app.

type Handler = () => boolean

const handlers: Handler[] = []

/** Overlays register a handler on mount (LIFO - the topmost overlay gets the
 *  back press first) and unregister with the returned function. A handler
 *  returns true when it consumed the press. */
export function onBackButton(handler: Handler): () => void {
  handlers.push(handler)
  return () => {
    const i = handlers.indexOf(handler)
    if (i !== -1) handlers.splice(i, 1)
  }
}

const BUFFER = 3

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true // iOS
  )
}

let armed = false
let refillTimer: ReturnType<typeof setTimeout> | undefined

function refillGuards() {
  const depth = (history.state as { guard?: number } | null)?.guard ?? -1
  for (let i = depth + 1; i < BUFFER; i++) history.pushState({ guard: i }, '')
}

export function armBackGuard() {
  if (armed || !isStandalone()) return
  armed = true
  refillGuards()
  window.addEventListener('popstate', (e) => {
    // the UI response comes first, so the target screen paints immediately
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i]()) break
    }
    // iOS animates swipe-back with a SNAPSHOT of the page, and mutating
    // history while that transition is still settling leaves the stale
    // snapshot frozen on screen for seconds. So the sentinel refill waits a
    // beat - unless this pop landed on the real base entry, where one more
    // press would leave the app: there the refill must be immediate.
    clearTimeout(refillTimer)
    const depth = (e.state as { guard?: number } | null)?.guard ?? -1
    if (depth < 0) refillGuards()
    else refillTimer = setTimeout(refillGuards, 400)
  })
}
