// Demo mode: the whole app runs against an in-browser fake of the Supabase
// client (see demoClient.ts) - no network, no accounts, data in localStorage.
// Entered via ?demo in the URL (the README links there) or the Auth screen's
// "Try the demo" button; the flag persists so reloads stay in the demo.

const FLAG = 'demo-mode'

// arriving with ?demo turns the mode on, then cleans the URL
if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('demo')) {
  localStorage.setItem(FLAG, '1')
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
