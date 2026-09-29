// refresh-coach: rewrites this week's training review on demand. Called by
// the Workout tab after an injury is reported or marked healed, so the
// coach's note reflects it now instead of at the next weekly cron pass.
//
// Runs as the caller (their JWT -> RLS client), and maybeTrainingReview
// scopes every query by the caller's own user id - it can only ever read
// and write the signed-in user's rows.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { maybeTrainingReview } from '../_shared/trainingReview.ts'
import { normLang } from '../_shared/lang.ts'
import { addDays, userNow } from '../_shared/localtime.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ error: 'not authenticated' }, 401)

    const { data: settings } = await supabase
      .from('user_settings')
      .select('timezone, language')
      .eq('user_id', auth.user.id)
      .maybeSingle()
    const lang = normLang(body.lang ?? settings?.language)
    const { date, weekday } = userNow(settings?.timezone)
    const weekStart = addDays(date, -(weekday - 1)) // Monday of the current week

    const written = await maybeTrainingReview(supabase, auth.user.id, lang, weekStart, true)
    return json({ refreshed: written })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
