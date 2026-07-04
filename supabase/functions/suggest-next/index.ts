// suggest-next: one tap -> ONE gentle suggestion for what to do next.
// Sends today's pending tasks + energy + local time to Gemini, gets back a
// single task_id and a short low-pressure reason. Read-only: no DB writes,
// no ai_actions row.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Cheapest first; fallbacks cover per-model overload (503) and quota (429).
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']

// mirror the Now screen: never suggest a task the UI is hiding at this energy
const TIER_BY_ENERGY: Record<string, string[]> = {
  low: ['core'],
  medium: ['core', 'standard'],
  high: ['core', 'standard', 'bonus'],
}

const responseSchema = {
  type: 'OBJECT',
  properties: {
    task_id: { type: 'STRING' },
    reason: { type: 'STRING' },
  },
  required: ['task_id', 'reason'],
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
    const { date, weekday, time } = await req.json()
    if (!date || !weekday) return json({ error: 'date and weekday are required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ error: 'not authenticated' }, 401)

    const [{ data: routines }, { data: logs }, { data: state }] = await Promise.all([
      supabase.from('routines').select('id, name, sort_order, tasks(id, label, tier, scheduled_days)').order('sort_order'),
      supabase.from('task_logs').select('task_id, status').eq('date', date),
      supabase.from('daily_state').select('energy').eq('date', date).maybeSingle(),
    ])
    const logByTask = new Map((logs ?? []).map((l) => [l.task_id, l.status]))

    const visibleTiers = TIER_BY_ENERGY[state?.energy ?? 'medium'] ?? TIER_BY_ENERGY.medium
    const pending: { id: string; label: string; routine: string; tier: string }[] = []
    for (const r of routines ?? []) {
      for (const t of r.tasks ?? []) {
        if (!t.scheduled_days?.includes(weekday)) continue
        if (!visibleTiers.includes(t.tier)) continue
        if (logByTask.get(t.id)) continue // done/skipped/partial = handled
        pending.push({ id: t.id, label: t.label, routine: r.name, tier: t.tier })
      }
    }
    if (pending.length === 0) return json({ task_id: null, reason: null })

    const prompt = `You help someone with AuDHD pick ONE next task. They asked "what's next?".
Local time: ${time ?? 'unknown'}. Today's energy: ${state?.energy ?? 'not set'}.

Pending tasks (pick exactly one task_id from these):
${pending.map((p) => `- task_id=${p.id} | ${p.routine} | ${p.label} | tier=${p.tier}`).join('\n')}

Rules:
- Pick the single most sensible task for the time of day and energy. Prefer core-tier
  tasks and quick wins when energy is low.
- reason: one short, warm sentence for why this one now. Lower the activation energy
  ("takes 10 seconds", "you're already up"). Never mention what's overdue, missed,
  or how much is left. No exclamation marks, no shame, no urgency.`

    let gemini: { candidates?: { content?: { parts?: { text?: string }[] } }[] } | null = null
    let lastError = ''
    for (const model of GEMINI_MODELS) {
      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0.4 },
          }),
        },
      )
      if (geminiRes.ok) {
        gemini = await geminiRes.json()
        break
      }
      lastError = `${model}: ${await geminiRes.text()}`
      if (geminiRes.status !== 503 && geminiRes.status !== 429) break
    }
    if (!gemini) return json({ error: `Gemini error: ${lastError}` }, 502)
    const parsed = JSON.parse(gemini.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}')

    const match = pending.find((p) => p.id === parsed.task_id) ?? pending[0]
    return json({ task_id: match.id, label: match.label, routine: match.routine, reason: parsed.reason ?? '' })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
