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

export function armBackGuard() {
  if (armed || !isStandalone()) return
  armed = true
  for (let i = 0; i < BUFFER; i++) history.pushState({ guard: i }, '')
  window.addEventListener('popstate', (e) => {
    // refill before handling so a rapid second press still lands on a guard
    const depth = (e.state as { guard?: number } | null)?.guard ?? -1
    for (let i = depth + 1; i < BUFFER; i++) history.pushState({ guard: i }, '')
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i]()) return
    }
  })
}
