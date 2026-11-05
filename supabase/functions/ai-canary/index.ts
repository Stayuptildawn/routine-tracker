// ai-canary: pg_cron once a day. Sends one trivial request through the same
// Gemini model chain the composer uses; if EVERY model fails, web-pushes the
// owner so upstream breakage (quota exhausted, model retired, key revoked)
// is noticed the same morning instead of at the next composer message.
// Born of 2026-07-11, when gemini-2.5-flash was retired and nobody knew.
//
// Deploy with verify_jwt OFF; authenticated by x-cron-secret matched against
// the CANARY_SECRET env (its own secret, so rotating it never breaks the
// other cron jobs). Also needs OWNER_EMAIL plus the usual VAPID_* secrets.

import { createClient } from 'npm:@supabase/supabase-js@2.110.0'
import { askGemini } from '../_shared/gemini.ts'
import { json, secretMatches } from '../_shared/http.ts'
import { pushToUser, setVapid } from '../_shared/push.ts'

Deno.serve(async (req) => {
  if (!(await secretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CANARY_SECRET')))) {
    return new Response('forbidden', { status: 403 })
  }

  // same model chain and fatality rules as the parser, via the shared helper
  const { model, error: lastError } = await askGemini('Reply with the single word: ok', {
    maxOutputTokens: 10,
    temperature: 0,
  })
  if (model) return json({ ok: true, model })

  // every model failed - tell the owner while it's still morning
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const ownerEmail = Deno.env.get('OWNER_EMAIL')?.toLowerCase()
    // page through every user - the owner may not sit on the first page
    let owner: { id: string } | undefined
    for (let page = 1; ownerEmail && !owner; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
      if (error) throw error
      owner = data.users.find((u) => u.email?.toLowerCase() === ownerEmail && u.email_confirmed_at)
      if (data.users.length < 200) break
    }
    if (owner) {
      setVapid()
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', owner.id)
      const payload = JSON.stringify({
        title: 'Routine Tracker',
        body: `Heads up: the AI pipeline is failing (${lastError.slice(0, 140)})`,
        tag: 'ai-canary', // replaces, never stacks
      })
      await pushToUser(supabase, owner.id, subs ?? [], payload, 'ai-canary')
    }
  } catch (err) {
    console.error('ai-canary alert failed:', err)
  }

  return json({ ok: false, error: lastError }, 500)
})
