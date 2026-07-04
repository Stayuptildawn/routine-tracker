// weekly-reflection: Sunday evening, two specific sentences about the week.
// Triggered by pg_cron -> net.http_post; deploy with verify_jwt OFF -
// authenticated by the x-cron-secret header instead.
//
// Runs with the service role: every query scopes by user_id explicitly.
//
// The bar for the text: it must name a real routine/task and use a real
// number or comparison. Generic coach-speak is banned in the prompt AND
// checked after - a vague reflection is worse than none.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { GEMINI_MODELS } from '../_shared/interpret.ts'
import { userNow, addDays } from '../_shared/localtime.ts'

const FORBIDDEN =
  /\b(failed|failure|missed|only|just|should|behind|lazy|slipped)\b|great job|keep it up|well done|good work|stay(ing)? consistent|consistency/i

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

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { date, weekday } = userNow()
    const weekStart = addDays(date, -(weekday - 1)) // Monday of the current week
    const prevStart = addDays(weekStart, -7)
    const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
    const prevDates = Array.from({ length: 7 }, (_, i) => addDays(prevStart, i))
    const allDates = [...prevDates, ...weekDates]

    const { data: usersPage } = await supabase.auth.admin.listUsers({ perPage: 10 })
    const results: Record<string, string> = {}

    for (const user of usersPage?.users ?? []) {
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, tasks(id, label, tier, scheduled_days)')
        .eq('user_id', user.id)
      const tasks = (routines ?? []).flatMap((r) => (r.tasks ?? []).map((t) => ({ ...t, routine: r.name })))
      if (tasks.length === 0) continue
      const taskById = new Map(tasks.map((t) => [t.id, t]))

      const [{ data: logs }, { data: states }, { data: sessions }, { data: cardio }, { data: checkins }, { data: reminders }] =
        await Promise.all([
          supabase.from('task_logs').select('task_id, date, status').in('task_id', [...taskById.keys()]).in('date', allDates),
          supabase.from('daily_state').select('date, energy').eq('user_id', user.id).in('date', weekDates),
          supabase
            .from('planned_sessions')
            .select('split_day, completed_at, week_number')
            .eq('user_id', user.id)
            .gte('completed_at', weekStart + 'T00:00:00'),
          supabase.from('cardio_logs').select('kind, minutes, distance_km, date').eq('user_id', user.id).gte('date', weekStart),
          supabase.from('recovery_checkins').select('muscle_group, amount').eq('user_id', user.id).gte('created_at', weekStart + 'T00:00:00'),
          supabase.from('reminders').select('status, created_at, updated_at').eq('user_id', user.id).gte('updated_at', weekStart + 'T00:00:00'),
        ])

      // per-routine: done/scheduled this week vs last, plus which days landed
      const routineLines: string[] = []
      for (const r of routines ?? []) {
        const rTasks = (r.tasks ?? [])
        if (rTasks.length === 0) continue
        const stat = (dates: string[]) => {
          let scheduled = 0
          let done = 0
          const daysHit = new Set<string>()
          dates.forEach((d, i) => {
            for (const t of rTasks) {
              if (!t.scheduled_days?.includes(i + 1)) continue
              scheduled++
              const log = (logs ?? []).find((l) => l.task_id === t.id && l.date === d)
              if (log && (log.status === 'done' || log.status === 'partial')) {
                done++
                daysHit.add(DAY_NAMES[i])
              }
            }
          })
          return { scheduled, done, daysHit }
        }
        const now = stat(weekDates)
        const prev = stat(prevDates)
        if (now.scheduled === 0) continue
        routineLines.push(
          `- ${r.name}: ${now.done}/${now.scheduled} this week (last week ${prev.done}/${prev.scheduled}); days with completions: ${[...now.daysHit].join(' ') || 'none'}`,
        )
      }

      const energyLine = weekDates
        .map((d, i) => {
          const e = (states ?? []).find((s) => s.date === d)?.energy
          return e ? `${DAY_NAMES[i]}=${e}` : null
        })
        .filter(Boolean)
        .join(', ')

      const doneSessions = (sessions ?? []).filter((s) => s.completed_at)
      const cardioKm = (cardio ?? []).reduce((n, c) => n + Number(c.distance_km ?? 0), 0)
      const cardioMin = (cardio ?? []).reduce((n, c) => n + Number(c.minutes ?? 0), 0)
      const flags = (checkins ?? []).filter((c) => c.amount === 'over_the_line').map((c) => c.muscle_group)
      const remindersDone = (reminders ?? []).filter((r) => r.status === 'done').length

      const prompt = `You write a tiny weekly reflection for someone with AuDHD who tracks daily routines.
Week ${weekStart} to ${weekDates[6]}. Their data:

Routines (done/scheduled, with last week for comparison):
${routineLines.join('\n') || 'nothing scheduled'}

Energy check-ins: ${energyLine || 'none set'}
Training: ${doneSessions.length} session(s) finished (${doneSessions.map((s) => s.split_day).join(', ') || 'none'})
Cardio: ${cardioKm > 0 ? `${Math.round(cardioKm * 10) / 10} km` : ''}${cardioMin > 0 ? ` ${Math.round(cardioMin)} min total` : ''}${cardioKm + cardioMin === 0 ? 'none logged' : ''}
Recovery flags ("too much" answers): ${flags.join(', ') || 'none'}
Reminders completed: ${remindersDone}

Write EXACTLY two sentences:
1. One specific, true pattern from the data above. It MUST name at least one real
   routine, task or session by name AND use a real number, weekday or
   week-over-week change. Prefer the most interesting contrast (improvement,
   an energy-completion link, a routine that works on some days and not others).
2. One small experiment for next week, phrased as a question starting with
   "Want to", directly connected to the pattern in sentence 1.

Hard rules: never use the words failed, missed, only, just, should, behind,
lazy. No generic praise (no "great job", "keep it up", "well done",
"consistency"). Never count or dwell on what didn't happen - frame around
what did. Skips are deliberate self-management. No exclamation marks, no
emoji, no preamble - reply with the two sentences and nothing else.

Example of the expected quality: "Bedtime Routine landed 6 of 7 nights and
both low-energy days still closed out every core task. Want to try giving
Study Time the same 9am slot where 4 of its 5 completions happened?"`

      let body = await askGemini(prompt)
      if (!body) continue
      if (FORBIDDEN.test(body)) {
        body = await askGemini(prompt + `\n\nYour previous draft broke the rules (generic or banned wording). Rewrite it: specific names and numbers, no filler.`)
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
