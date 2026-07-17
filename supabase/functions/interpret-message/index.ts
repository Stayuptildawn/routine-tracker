// interpret-message: parses free text into structured actions and applies them.
// "took my meds and drank water" -> check off tasks
// "bench 60kg 3x8" -> workout log row
// "remind me to email the lawyer" -> categorized reminder
// "low energy today" -> daily_state energy
//
// Trust rules: confidence >= 0.9 applied immediately (undoable via ai_actions);
// 0.6-0.9 returned as suggestions for one-tap confirm chips; below 0.6 dropped.
//
// The actual interpret+apply logic lives in ../_shared/interpret.ts, shared
// with telegram-webhook. This wrapper handles CORS + browser auth (RLS client).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { interpretAndApply } from '../_shared/interpret.ts'

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
    const { text, date, weekday, time, lang } = await req.json()
    if (!text || !date || !weekday) return json({ error: 'text, date and weekday are required' }, 400)
    const localTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '') ? time : undefined

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ error: 'not authenticated' }, 401)

    const result = await interpretAndApply(supabase, auth.user.id, text, date, weekday, localTime, lang)
    return json(result, result.error ? 502 : 200)
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
