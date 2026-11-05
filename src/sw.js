// Custom service worker (injectManifest mode): precache like generateSW did,
// plus web push. Kept as .js on purpose - tsc only checks src/*.ts*.
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching'
import { clientsClaim } from 'workbox-core'

self.skipWaiting()
clientsClaim()
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

/** Only pages inside this app's scope - a push payload must never be able to
 *  send a tap somewhere else. */
function inScope(url) {
  try {
    const u = new URL(url, self.registration.scope)
    return u.href.startsWith(self.registration.scope) ? u.href : self.registration.scope
  } catch {
    return self.registration.scope
  }
}

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title ?? 'Routine Tracker', {
      body: data.body ?? '',
      icon: new URL('icon.svg', self.registration.scope).href,
      tag: data.tag, // same-routine nudges replace, never stack
      data: { url: inScope(data.url ?? self.registration.scope) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const w of windows) if ('focus' in w) return w.focus()
      return self.clients.openWindow(inScope(event.notification.data?.url ?? self.registration.scope))
    }),
  )
})
