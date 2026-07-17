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
  return sub ? 'on' : 'off'
}

export async function enableNudges(): Promise<'on' | 'denied' | 'unsupported'> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC!) as BufferSource,
    }))
  const keys = sub.toJSON().keys
  if (!keys?.p256dh || !keys?.auth) throw new Error('subscription missing keys')
  const { error } = await supabase
    .from('push_subscriptions')
    .upsert({ endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth })
  if (error) throw error
  return 'on'
}

export async function disableNudges(): Promise<void> {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}
