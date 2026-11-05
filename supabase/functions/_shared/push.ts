// Web push delivery shared by the cron functions. Endpoints come from the
// client, so they are only trusted after the same host allowlist the database
// enforces (0031), and every send has a timeout: one slow push service must
// not hold a run that walks every user.

import webpush from 'npm:web-push@3.6.7'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0'

/** Mirror of the push_subscriptions_endpoint_host check constraint. */
const PUSH_HOST =
  /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)\//

const SEND_TIMEOUT_MS = 5_000

export interface PushSub {
  endpoint: string
  p256dh: string
  auth: string
}

export function isPushEndpoint(endpoint: string): boolean {
  return PUSH_HOST.test(endpoint)
}

export function setVapid() {
  webpush.setVapidDetails(
    Deno.env.get('VAPID_SUBJECT')!,
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!,
  )
}

/** Sends one payload to all of a user's devices in parallel. Expired
 *  subscriptions (404/410) are removed - scoped to that user's own row.
 *  Returns how many devices accepted it. */
export async function pushToUser(
  supabase: SupabaseClient,
  userId: string,
  subs: PushSub[],
  payload: string,
  label: string,
): Promise<number> {
  const results = await Promise.allSettled(
    subs.filter((s) => isPushEndpoint(s.endpoint)).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { timeout: SEND_TIMEOUT_MS },
        )
        return true
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // subscription expired or revoked - clean it up
          await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).eq('user_id', userId)
        } else {
          console.error(`${label} push failed:`, status ?? String(err))
        }
        return false
      }
    }),
  )
  return results.filter((r) => r.status === 'fulfilled' && r.value).length
}
