// training-reflection: on-demand, a kind but truthful comment on the user's
// physical activity, comparing the last 7 days against the 7 before. Called
// from the Reflect tab with the user's JWT (verify_jwt ON) so every query is
// RLS-scoped to them automatically. Read-only, no writes.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { GEMINI_MODELS } from '../_shared/interpret.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const { date } = await req.json()
    if (!date) return json({ error: 'date required' }, 400)

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    })
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ error: 'not authenticated' }, 401)

    const thisStart = addDays(date, -6) // last 7 days incl. today
    const prevStart = addDays(date, -13)
    const prevEnd = addDays(date, -7)

    // gather both windows (RLS scopes to this user)
    const [sessionsRes, setsRes, cardioRes, checkinRes] = await Promise.all([
      supabase.from('planned_sessions').select('completed_at, split_day').gte('completed_at', prevStart + 'T00:00:00').not('completed_at', 'is', null),
      supabase.from('planned_sets').select('logged_at, muscle_group').gte('logged_at', prevStart + 'T00:00:00').not('logged_reps', 'is', null),
      supabase.from('cardio_logs').select('date, kind, distance_km, minutes, effort, amount').gte('date', prevStart),
      supabase.from('recovery_checkins').select('created_at, muscle_group, amount').gte('created_at', prevStart + 'T00:00:00'),
    ])

    const inThis = (d: string) => d.slice(0, 10) >= thisStart && d.slice(0, 10) <= date
    const inPrev = (d: string) => d.slice(0, 10) >= prevStart && d.slice(0, 10) <= prevEnd

    function window(pred: (d: string) => boolean) {
      const sessions = (sessionsRes.data ?? []).filter((s) => pred(s.completed_at)).map((s) => s.split_day)
      const sets = (setsRes.data ?? []).filter((s) => pred(s.logged_at)).length
      const cardio = (cardioRes.data ?? []).filter((c) => pred(c.date))
      const km = cardio.reduce((n, c) => n + Number(c.distance_km ?? 0), 0)
      const min = cardio.reduce((n, c) => n + Number(c.minutes ?? 0), 0)
      const overCardio = cardio.filter((c) => c.amount === 'over_the_line').length
      const overLifts = (checkinRes.data ?? []).filter((c) => pred(c.created_at) && c.amount === 'over_the_line').map((c) => c.muscle_group)
      return {
        sessions: sessions.length,
        splits: [...new Set(sessions)].join(', ') || 'none',
        sets,
        cardioSessions: cardio.length,
        km: Math.round(km * 10) / 10,
        min: Math.round(min),
        overCardio,
        overLifts: [...new Set(overLifts)].join(', ') || 'none',
      }
    }

    const now = window(inThis)
    const prev = window(inPrev)

    const prompt = `You comment on someone's physical training. Be kind but truthful.
Compare this week against last week.

This week (last 7 days):
  gym sessions finished: ${now.sessions} (${now.splits}), hard sets logged: ${now.sets}
  cardio: ${now.cardioSessions} sessions, ${now.km} km, ${now.min} min
  flagged "too much": lifts ${now.overLifts}, cardio ${now.overCardio}

Last week (the 7 days before that):
  gym sessions finished: ${prev.sessions} (${prev.splits}), hard sets logged: ${prev.sets}
  cardio: ${prev.cardioSessions} sessions, ${prev.km} km, ${prev.min} min
  flagged "too much": lifts ${prev.overLifts}, cardio ${prev.overCardio}

Write 2 to 3 sentences:
- Name at least one real number and one real comparison (up, down, or steady).
- If this week is lower, say so plainly but without blame - a lighter week can be
  smart, and rest is training too. If it's higher, acknowledge the work honestly.
- If something was flagged "too much", gently note easing there.
- End with one small, concrete thing to aim for next week.

Rules: kind but honest, never flattering or fake-positive. Never use the words
failed, missed, only, just, should, behind, lazy, or "great job" / "keep it up".
No exclamation marks, no emoji, no preamble. Reply with the sentences and nothing else.`

    let comment: string | null = null
    for (const model of GEMINI_MODELS) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5 } }),
      })
      if (res.ok) {
        const d = await res.json()
        comment = d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
        break
      }
      if (res.status !== 503 && res.status !== 429) break
    }
    if (!comment) return json({ error: 'AI unavailable' }, 502)

    const noData = now.sessions + now.sets + now.cardioSessions + prev.sessions + prev.sets + prev.cardioSessions === 0
    return json({ comment, noData })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
