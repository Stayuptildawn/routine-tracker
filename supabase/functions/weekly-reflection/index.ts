// weekly-reflection: two specific sentences about the week so far. pg_cron
// fires this every 15 minutes; each user gets a fresh reflection twice a day
// in THEIR timezone - a morning pass and a closing pass (after the 21:30
// pre-reflection nudge has reminded them to log the day). Each user's passes
// sit at a stable per-user minute within the 45 minutes after 09:00 / 22:00,
// so a whole timezone's cohort never lands on a single tick. Deploy with
// verify_jwt OFF - authenticated by the x-cron-secret header instead. A
// manual run can pass {"force": true} to skip the time windows.
//
// Runs with the service role: every query scopes by user_id explicitly.
//
// The bar for the text: it must name a real routine/task and use a real
// number or comparison. Generic coach-speak is banned in the prompt AND
// checked after - a vague reflection is worse than none.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { askGemini } from '../_shared/gemini.ts'
import { json } from '../_shared/http.ts'
import { LANGUAGE_NAMES, normLang } from '../_shared/lang.ts'
import { userNow, addDays, userSpreadMinutes } from '../_shared/localtime.ts'
import { maybeTrainingReview } from '../_shared/trainingReview.ts'

// English-only by design: non-English reflections rely on the prompt-level
// ban (translated equivalents can't be enumerated reliably), and English
// words sneaking into a non-English reply would still be caught here.
const FORBIDDEN =
  /\b(failed|failure|missed|only|just|should|behind|lazy|slipped)\b|great job|keep it up|well done|good work|stay(ing)? consistent|consistency/i

const ask = async (prompt: string) => (await askGemini(prompt, { temperature: 0.6 })).text

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const MORNING_MIN = 9 * 60 // 09:00 local - the week-so-far card refreshes
const NIGHT_MIN = 22 * 60 // 22:00 local - the closing pass, after the day is logged
const WINDOW_MIN = 15 // must match the cron cadence
const SPREAD_MIN = 45 // per-user jitter span; night pass still ends before midnight

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    // cron sends no body; a manual run can send {"force": true}
    const { force } = await req.json().catch(() => ({ force: false }))
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // page through ALL users - a fixed perPage would silently drop whoever
    // lands past the first page
    const users = []
    for (let page = 1; ; page++) {
      const { data: usersPage } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
      users.push(...(usersPage?.users ?? []))
      if ((usersPage?.users ?? []).length < 200) break
    }
    const results: Record<string, string> = {}

    for (const user of users) {
      // each user's day runs in their own timezone (and language), read fresh every tick
      const { data: us } = await supabase.from('user_settings').select('timezone, language').eq('user_id', user.id).maybeSingle()
      const lang = normLang(us?.language)
      const { date, weekday, minutes } = userNow(us?.timezone)
      const offset = userSpreadMinutes(user.id, SPREAD_MIN)
      const inWindow = (m: number) => minutes >= m + offset && minutes < m + offset + WINDOW_MIN
      if (!force && !inWindow(MORNING_MIN) && !inWindow(NIGHT_MIN)) continue
      const weekStart = addDays(date, -(weekday - 1)) // Monday of the current week

      // weekly training review (trend read + plan advice): once per week,
      // self-healing - the first pass that finds no row for this week writes
      // it. Runs before the routine guards below so a user who lifts but has
      // no routine tasks still gets one.
      try {
        await maybeTrainingReview(supabase, user.id, lang, weekStart, force)
      } catch (err) {
        console.error('training-review error:', user.id, err)
      }

      const prevStart = addDays(weekStart, -7)
      const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
      const prevDates = Array.from({ length: 7 }, (_, i) => addDays(prevStart, i))
      const allDates = [...prevDates, ...weekDates]
      const { data: routines } = await supabase
        .from('routines')
        .select('id, name, tasks(id, label, tier, scheduled_days)')
        .eq('user_id', user.id)
        .eq('active', true)
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
          supabase.from('cardio_logs').select('kind, minutes, distance_km, date, effort, body, amount').eq('user_id', user.id).gte('date', weekStart),
          supabase.from('recovery_checkins').select('muscle_group, amount').eq('user_id', user.id).gte('created_at', weekStart + 'T00:00:00'),
          supabase.from('reminders').select('status, created_at, updated_at').eq('user_id', user.id).gte('updated_at', weekStart + 'T00:00:00'),
        ])

      // an empty week has nothing to reflect on - skip the AI call entirely
      const weekHasData =
        (logs ?? []).some((l) => weekDates.includes(l.date)) || (sessions ?? []).length > 0 || (cardio ?? []).length > 0
      if (!weekHasData) continue

      // cold start: if last week has no logs at all, they hadn't started
      // logging yet - comparing against that emptiness reads as a huge spike
      // and produces nonsense advice ("maybe rest"), so drop the comparison
      const prevHadData = (logs ?? []).some((l) => prevDates.includes(l.date))

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
          `- ${r.name}: ${now.done}/${now.scheduled} this week${prevHadData ? ` (last week ${prev.done}/${prev.scheduled})` : ''}; days with completions: ${[...now.daysHit].join(' ') || 'none'}`,
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
      const cardioFeel = (cardio ?? [])
        .filter((c) => c.effort || c.body || c.amount)
        .map((c) => `${c.kind}: ${[c.effort, c.body, c.amount].filter(Boolean).join('/')}`)
        .join('; ')
      const remindersDone = (reminders ?? []).filter((r) => r.status === 'done').length

      const prompt = `You write a tiny weekly reflection for someone with AuDHD who tracks daily routines.
Week ${weekStart} to ${weekDates[6]}, seen as of ${date}. Their data:
${prevHadData ? '' : `
IMPORTANT: they started logging THIS WEEK. There is no earlier data - the time before
is unknown, not zero, not rest. Never compare to previous weeks, never call this week
a jump or increase, and never suggest easing off because of it. This week is the
opening baseline.
`}
Routines (done/scheduled${prevHadData ? ', with last week for comparison' : ''}):
${routineLines.join('\n') || 'nothing scheduled'}

Energy check-ins: ${energyLine || 'none set'}
Training: ${doneSessions.length} session(s) finished (${doneSessions.map((s) => s.split_day).join(', ') || 'none'})
Cardio: ${cardioKm > 0 ? `${Math.round(cardioKm * 10) / 10} km` : ''}${cardioMin > 0 ? ` ${Math.round(cardioMin)} min total` : ''}${cardioKm + cardioMin === 0 ? 'none logged' : ''}
Recovery flags ("too much" answers): ${flags.join(', ') || 'none'}
Cardio feel (effort/body/amount per entry): ${cardioFeel || 'not asked'}
Reminders completed: ${remindersDone}

Write EXACTLY two sentences, in ${LANGUAGE_NAMES[lang]}:
1. One specific, true pattern from the data above. It MUST name at least one real
   routine, task or session by name (keep the names exactly as written in the
   data) AND use a real number, weekday or week-over-week change. Prefer the
   most interesting contrast (improvement, an energy-completion link, a routine
   that works on some days and not others).
2. One small experiment for next week, phrased as an inviting question — the
   natural ${LANGUAGE_NAMES[lang]} equivalent of "Want to try...?" — directly
   connected to the pattern in sentence 1.

Hard rules: never use ${LANGUAGE_NAMES[lang]} words meaning failed, missed,
only, just, should, behind, lazy. No generic praise (nothing like "great job",
"keep it up", "well done", "consistency"). Never count or dwell on what didn't
happen - frame around what did. Skips are deliberate self-management. No
exclamation marks, no emoji, no preamble - reply with the two sentences in
${LANGUAGE_NAMES[lang]} and nothing else.

Example of the expected quality (the example is English, but your reply must
be in ${LANGUAGE_NAMES[lang]}): "Bedtime Routine landed 6 of 7 nights and
both low-energy days still closed out every core task. Want to try giving
Study Time the same 9am slot where 4 of its 5 completions happened?"`

      let body = await ask(prompt)
      if (!body) continue
      if (FORBIDDEN.test(body)) {
        body = await ask(prompt + `\n\nYour previous draft broke the rules (generic or banned wording). Rewrite it: specific names and numbers, no filler.`)
        if (!body || FORBIDDEN.test(body)) continue
      }

      await supabase
        .from('reflections')
        .upsert({ user_id: user.id, week_start: weekStart, body }, { onConflict: 'user_id,week_start' })
      results[user.id] = body
    }

    return json({ reflected: Object.keys(results).length })
  } catch (err) {
    console.error('weekly-reflection error:', err)
    return json({ error: String(err) }, 500)
  }
})
