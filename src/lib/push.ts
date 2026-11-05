import { supabase } from './supabase'
import { isDemo } from './demo'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Push needs a service worker, the API, and a configured VAPID key.
 *  (iOS additionally requires the PWA installed to the home screen.) */
export function pushSupported(): boolean {
  // no push server behind the demo - hide the whole nudges UI there
  if (isDemo) return false
  return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC
}

export async function getNudgeState(): Promise<'on' | 'off' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return 'off'
  // the browser can hold a subscription another account on this device
  // registered - it's only "on" when the row is this account's own
  const { data } = await supabase.from('push_subscriptions').select('endpoint').eq('endpoint', sub.endpoint).maybeSingle()
  return data ? 'on' : 'off'
}

export async function enableNudges(): Promise<'on' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const subscribe = () =>
    reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC!) as BufferSource,
    })
  const save = (sub: PushSubscription) => {
    const keys = sub.toJSON().keys
    if (!keys?.p256dh || !keys?.auth) throw new Error('subscription missing keys')
    return supabase.from('push_subscriptions').upsert({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth })
  }
  const existing = await reg.pushManager.getSubscription()
  const { error } = await save(existing ?? (await subscribe()))
  if (error && existing) {
    // a leftover subscription another account on this device still owns:
    // retire it and register a fresh one for this account
    await existing.unsubscribe()
    const { error: retry } = await save(await subscribe())
    if (retry) throw retry
  } else if (error) {
    throw error
  }
  return 'on'
}

/** Stops this browser receiving pushes without touching the server row -
 *  for when the session is already gone (expired, or signed out elsewhere).
 *  The push service then answers 410 and the cron removes the row. */
export async function dropBrowserSubscription(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  await sub?.unsubscribe()
}

export async function disableNudges(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
