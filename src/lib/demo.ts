// Demo mode: the whole app runs against an in-browser fake of the Supabase
// client (see demoClient.ts) - no network, no accounts, data in localStorage.
// Entered via ?demo in the URL (the README links there) or the Auth screen's
// "Try the demo" button; the flag persists so reloads stay in the demo.

const FLAG = 'demo-mode'

/** A real Supabase session is stored under sb-<project>-auth-token. */
function hasRealSession(): boolean {
  for (let i = 0; i < localStorage.length; i++) {
    if (/^sb-.+-auth-token$/.test(localStorage.key(i) ?? '')) return true
  }
  return false
}

// arriving with ?demo turns the mode on, then cleans the URL. A link from
// anywhere can carry ?demo, so it only works while signed out - someone who
// is signed in uses the demo button after signing out instead.
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  if (!hasRealSession()) localStorage.setItem(FLAG, '1')
  const url = new URL(location.href)
  url.searchParams.delete('demo')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

export const isDemo = typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1'

export function enterDemo() {
  localStorage.setItem(FLAG, '1')
  location.reload()
}

export function exitDemo() {
  localStorage.removeItem(FLAG)
  localStorage.removeItem('demo-db')
  location.reload()
}
