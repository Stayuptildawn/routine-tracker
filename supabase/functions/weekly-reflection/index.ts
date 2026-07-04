// weekly-reflection: Sunday evening, two gentle sentences about the week.
// Triggered by pg_cron -> net.http_post (see private setup notes); deploy
// with verify_jwt OFF - authenticated by the x-cron-secret header instead.
//
// Runs with the service role: every query scopes by user_id explicitly.
// Single-user by design (reflects for every auth user, which is one).
//
// Prompt guardrails matter more than the data here: patterns + permission,
// never scorekeeping. Forbidden words are enforced in the prompt AND checked
// after - a reflection that shames is worse than no reflection.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { GEMINI_MODELS } from '../_shared/interpret.ts'
import { userNow, addDays } from '../_shared/localtime.ts'

const FORBIDDEN = /\b(failed|failure|missed|only|just|should|behind|lazy|slipped)\b/i

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function askGemini(prompt: string): Promise<string | null> {
  for (const model of GEMINI_MODELS) {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.6 },
        }),
      },
    )
    if (res.ok) {
      const data = await res.json()
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null
    }
    if (res.status !== 503 && res.status !== 429) break
  }
  return null
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { date, weekday } = userNow()
    const weekStart = addDays(date, -(weekday - 1)) // Monday of the current week
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

    const { data: usersPage } = await supabase.auth.admin.listUsers({ perPage: 10 })
    const results: Record<string, string> = {}

    for (const user of usersPage?.users ?? []) {
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, tasks(id, label, tier, scheduled_days)')
        .eq('user_id', user.id)
      const tasks = (routines ?? []).flatMap((r) => r.tasks ?? [])
      if (tasks.length === 0) continue
      const taskById = new Map(tasks.map((t) => [t.id, t]))

      const [{ data: logs }, { data: states }] = await Promise.all([
        supabase.from('task_logs').select('task_id, date, status').in('task_id', [...taskById.keys()]).in('date', weekDates),
        supabase.from('daily_state').select('date, energy').eq('user_id', user.id).in('date', weekDates),
      ])
      const energyByDate = new Map((states ?? []).map((s) => [s.date, s.energy]))

      // per-day summary + per-task done counts, compact enough to prompt with
      const dayLines = weekDates.map((d, i) => {
        const wd = i + 1
        const scheduled = tasks.filter((t) => t.scheduled_days?.includes(wd)).length
        const dayLogs = (logs ?? []).filter((l) => l.date === d)
        const done = dayLogs.filter((l) => l.status === 'done' || l.status === 'partial').length
        const skipped = dayLogs.filter((l) => l.status === 'skipped').length
        return `${d} (${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i]}): ${done}/${scheduled} done, ${skipped} deliberately skipped, energy: ${energyByDate.get(d) ?? 'not set'}`
      })
      const doneCount = new Map<string, number>()
      for (const l of logs ?? []) {
        if (l.status === 'done' || l.status === 'partial') {
          const label = taskById.get(l.task_id)?.label ?? '?'
          doneCount.set(label, (doneCount.get(label) ?? 0) + 1)
        }
      }
      const topTasks = [...doneCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)

      const prompt = `You write a tiny weekly reflection for someone with AuDHD who tracks daily routines.
Their week (${weekStart} to ${weekDates[6]}):
${dayLines.join('\n')}
Tasks that happened most: ${topTasks.map(([l, n]) => `${l} (${n}x)`).join(', ') || 'none logged'}

Write EXACTLY two sentences:
1. One real pattern you can see in the data, stated warmly and specifically.
2. One small permission-based suggestion, phrased as a question starting with "Want to".

Hard rules: never use the words failed, missed, only, just, should, behind, lazy.
Never count or mention what didn't happen. Skips are deliberate self-management,
mention them positively if at all. No exclamation marks, no emoji, no preamble -
reply with the two sentences and nothing else.`

      let body = await askGemini(prompt)
      if (!body) continue
      if (FORBIDDEN.test(body)) {
        // one retry with the violation pointed out, then give up quietly
        body = await askGemini(prompt + `\n\nYour previous draft broke the word rules. Rewrite it without those words.`)
        if (!body || FORBIDDEN.test(body)) continue
      }

      await supabase
        .from('reflections')
        .upsert({ user_id: user.id, week_start: weekStart, body }, { onConflict: 'user_id,week_start' })
      results[user.id] = body
    }

    return json({ week_start: weekStart, reflected: Object.keys(results).length })
  } catch (err) {
    console.error('weekly-reflection error:', err)
    return json({ error: String(err) }, 500)
  }
})
