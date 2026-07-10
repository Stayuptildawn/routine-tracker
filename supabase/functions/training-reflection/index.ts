// training-reflection: on-demand, a kind but truthful read on the PATTERN of
// the user's physical activity over the last 12 weeks (averages, trend), plus
// everything they logged as feedback. Called from Reflect with the user's JWT
// (verify_jwt ON) so every query is RLS-scoped to them. Read-only.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { GEMINI_MODELS } from '../_shared/interpret.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const WEEKS = 12

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
function mondayOf(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  return addDays(date, -((d.getUTCDay() + 6) % 7))
}
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const trend = (first: number, last: number) => {
  if (first === 0 && last === 0) return 'flat'
  const change = last - first
  const rel = first ? change / first : 1
  if (Math.abs(rel) < 0.12) return 'steady'
  return change > 0 ? 'up' : 'down'
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

    const thisMonday = mondayOf(date)
    const windowStart = addDays(thisMonday, -7 * (WEEKS - 1)) // 12 weekly buckets
    const weekIdx = (d: string) => {
      const i = Math.floor((Date.parse(d.slice(0, 10) + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / (7 * 86400000))
      return i >= 0 && i < WEEKS ? i : -1
    }

    const [sessionsRes, setsRes, cardioRes, checkinRes] = await Promise.all([
      supabase.from('planned_sessions').select('completed_at').gte('completed_at', windowStart + 'T00:00:00').not('completed_at', 'is', null),
      supabase.from('planned_sets').select('logged_at').gte('logged_at', windowStart + 'T00:00:00').not('logged_reps', 'is', null),
      supabase.from('cardio_logs').select('date, distance_km, minutes, effort, body, amount').gte('date', windowStart),
      supabase.from('recovery_checkins').select('created_at, muscle_group, recovery, effort, amount').gte('created_at', windowStart + 'T00:00:00'),
    ])

    // weekly series (oldest -> newest)
    const sessions = Array(WEEKS).fill(0)
    const sets = Array(WEEKS).fill(0)
    const cardioKm = Array(WEEKS).fill(0)
    const cardioN = Array(WEEKS).fill(0)
    for (const s of sessionsRes.data ?? []) { const i = weekIdx(s.completed_at); if (i >= 0) sessions[i]++ }
    for (const s of setsRes.data ?? []) { const i = weekIdx(s.logged_at); if (i >= 0) sets[i]++ }
    for (const c of cardioRes.data ?? []) {
      const i = weekIdx(c.date)
      if (i >= 0) { cardioKm[i] += Number(c.distance_km ?? 0); cardioN[i]++ }
    }

    const activity = sessions.map((_, i) => sessions[i] + sets[i] + cardioN[i])
    const activeWeeks = activity.filter((n) => n > 0).length
    if (activeWeeks < 2) return json({ comment: '', noData: true })

    // the window starts when logging did - empty weeks from before the app
    // was in use are unknown time, not rest, and comparing against them reads
    // as a false spike ("you're overreaching, take a break") to the model
    const firstActive = activity.findIndex((n) => n > 0)
    const span = WEEKS - firstActive
    const wSessions = sessions.slice(firstActive)
    const wSets = sets.slice(firstActive)
    const wCardioKm = cardioKm.slice(firstActive)
    const wActivity = activity.slice(firstActive)

    // averages over active weeks, and first-half vs second-half trend
    const activeAvg = (arr: number[]) => r1(avg(arr.filter((_, i) => wActivity[i] > 0)))
    const half = (arr: number[], side: 0 | 1) => {
      const mid = Math.ceil(arr.length / 2)
      return avg(side === 0 ? arr.slice(0, mid) : arr.slice(mid))
    }
    const trends = {
      sessions: trend(half(wSessions, 0), half(wSessions, 1)),
      sets: trend(half(wSets, 0), half(wSets, 1)),
      cardioKm: trend(half(wCardioKm, 0), half(wCardioKm, 1)),
    }

    // feedback patterns
    const AMT = ['could_take_more', 'right', 'stretch', 'over_the_line']
    const byMuscle: Record<string, Record<string, number>> = {}
    for (const c of checkinRes.data ?? []) {
      if (!c.amount) continue
      byMuscle[c.muscle_group] ??= {}
      byMuscle[c.muscle_group][c.amount] = (byMuscle[c.muscle_group][c.amount] ?? 0) + 1
    }
    const muscleLines = Object.entries(byMuscle).map(([m, counts]) => {
      const dom = AMT.filter((a) => counts[a]).sort((a, b) => counts[b] - counts[a])[0]
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      return `${m}: mostly "${dom.replace(/_/g, ' ')}" (${counts[dom]}/${total})`
    })
    const cardioFeel: Record<string, number> = {}
    for (const c of cardioRes.data ?? []) {
      for (const f of [c.effort, c.body, c.amount]) if (f) cardioFeel[f] = (cardioFeel[f] ?? 0) + 1
    }
    const cardioFeelLine =
      Object.entries(cardioFeel).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k.replace(/_/g, ' ')} ×${n}`).join(', ') || 'none logged'

    const prompt = `You read someone's training over time and name the real pattern. Kind but truthful.
Logging began ${span} week(s) ago - anything before that is simply unknown, NOT rest,
NOT a decline, and never a reason to suggest backing off. ${activeWeeks} of those weeks had activity.

Weekly series since logging began, oldest to newest (${span} numbers each):
  gym sessions: [${wSessions.join(', ')}]
  hard sets:    [${wSets.join(', ')}]
  cardio km:    [${wCardioKm.map(r1).join(', ')}]

Average per active week: ${activeAvg(wSessions)} sessions, ${activeAvg(wSets)} hard sets, ${activeAvg(wCardioKm)} km cardio.
Trend (first half vs second half): sessions ${trends.sessions}, hard sets ${trends.sets}, cardio ${trends.cardioKm}.

Feedback you logged:
  recovery by muscle: ${muscleLines.join('; ') || 'none yet'}
  cardio felt: ${cardioFeelLine}

Write 2 to 3 sentences that name the clearest PATTERN over these weeks (not a single
week). Use a real number, average, or trend, and bring in the logged feedback where it
fits (for example a muscle that keeps saying "over the line", or cardio that trends up).
If the pattern is a decline or a plateau, say it plainly but without blame - a lighter
stretch can be smart, and rest is part of training. End with one small, concrete thing
to aim for.

Rules: kind but honest, never flattering or fake-positive. Never use the words failed,
missed, only, just, should, behind, lazy, or "great job" / "keep it up". No exclamation
marks, no emoji, no preamble. If there are just a few weeks of data, say the pattern is
still forming. Reply with the sentences and nothing else.`

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
    return json({ comment, weeks: activeWeeks })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
