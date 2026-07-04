// Web Share Target (Android installed PWA): shares land here as query params.
// Captured once at startup, then stripped from the URL so a refresh or a
// shared link doesn't resend the same text.

let shared: string | null = null

const params = new URLSearchParams(window.location.search)
const parts = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean)
if (parts.length > 0) {
  shared = parts.join(' ').trim()
  window.history.replaceState(null, '', window.location.pathname + window.location.hash)
}

/** The shared text, at most once - it prefills the composer, never auto-sends. */
export function consumeSharedText(): string | null {
  const s = shared
  shared = null
  return s
}
