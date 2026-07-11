// ai-canary: pg_cron once a day. Sends one trivial request through the same
// Gemini model chain the composer uses; if EVERY model fails, web-pushes the
// owner so upstream breakage (quota exhausted, model retired, key revoked)
// is noticed the same morning instead of at the next composer message.
// Born of 2026-07-11, when gemini-2.5-flash was retired and nobody knew.
//
// Deploy with verify_jwt OFF; authenticated by x-cron-secret matched against
// the CANARY_SECRET env (its own secret, so rotating it never breaks the
// other cron jobs). Also needs OWNER_EMAIL plus the usual VAPID_* secrets.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'
import { GEMINI_MODELS } from '../_shared/interpret.ts'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CANARY_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  let lastError = ''
  for (const model of GEMINI_MODELS) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with the single word: ok' }] }],
          generationConfig: { maxOutputTokens: 10, temperature: 0 },
        }),
      })
      if (res.ok) return json({ ok: true, model })
      lastError = `${model}: HTTP ${res.status}`
      if (![503, 429, 404].includes(res.status)) break // same fatality rules as the parser
    } catch (err) {
      lastError = `${model}: ${err}`
    }
  }

  // every model failed - tell the owner while it's still morning
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ownerEmail = Deno.env.get('OWNER_EMAIL')
    const { data } = ownerEmail ? await supabase.auth.admin.listUsers({ page: 1, perPage: 200 }) : { data: null }
    const owner = data?.users?.find((u) => u.email === ownerEmail)
    if (owner) {
      webpush.setVapidDetails(
        Deno.env.get('VAPID_SUBJECT')!,
        Deno.env.get('VAPID_PUBLIC_KEY')!,
        Deno.env.get('VAPID_PRIVATE_KEY')!,
      )
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', owner.id)
      const payload = JSON.stringify({
        title: 'Routine Tracker',
        body: `Heads up: the AI pipeline is failing (${lastError.slice(0, 140)})`,
        tag: 'ai-canary', // replaces, never stacks
      })
      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload)
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
        }
      }
    }
  } catch (err) {
    console.error('ai-canary alert failed:', err)
  }

  return json({ ok: false, error: lastError }, 500)
})
