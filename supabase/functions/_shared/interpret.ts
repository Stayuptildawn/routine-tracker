// Shared interpret+apply core, used by interpret-message (browser, RLS client)
// and telegram-webhook (service-role client). Because the service role
// bypasses RLS and auth.uid() defaults, every query here scopes by an explicit
// userId and every insert sets user_id explicitly - do not remove those.

// deno-lint-ignore-file no-explicit-any

import { addDays, userNow } from './localtime.ts'
import {
  addMinutesToClock,
  clampDaysAgo,
  mentionsYesterday,
  normalizeAvgHr,
  normalizeDueInMinutes,
  normalizeDueTime,
  parseAbsoluteTime,
  parseBpm,
  parseRelativeDay,
  parseRelativeMinutes,
} from './timeparse.ts'

// Fast-and-cheap first: heavier "latest" aliases run thinking passes that
// blow the edge-function worker limit. The lite models drop the reminder
// time fields sometimes, so the create_reminder path re-parses times from
// the raw text deterministically below. Fallbacks cover per-model overload
// (503), quota (429) and retirement (404).
export const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite']
const APPLY_THRESHOLD = 0.9
const SUGGEST_THRESHOLD = 0.6

const responseSchema = {
  type: 'OBJECT',
  properties: {
    actions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          type: {
            type: 'STRING',
            enum: ['check_task', 'log_workout', 'log_cardio', 'create_reminder', 'complete_reminder', 'set_energy', 'query_last_done', 'query_last_workout', 'query_reminders'],
          },
          task_id: { type: 'STRING' },
          status: { type: 'STRING', enum: ['done', 'partial', 'skipped'] },
          confidence: { type: 'NUMBER' },
          exercise: { type: 'STRING' },
          sets: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { kg: { type: 'NUMBER' }, reps: { type: 'NUMBER' } },
            },
          },
          reminder_text: { type: 'STRING' },
          category: { type: 'STRING' },
          due_date: { type: 'STRING' },
          due_time: { type: 'STRING' },
          due_in_minutes: { type: 'NUMBER' },
          reminder_id: { type: 'STRING' },
          reminder_status: { type: 'STRING', enum: ['done', 'dismissed'] },
          days_ago: { type: 'NUMBER' },
          kind: { type: 'STRING', enum: ['run', 'walk', 'cycle', 'swim', 'other'] },
          minutes: { type: 'NUMBER' },
          distance_km: { type: 'NUMBER' },
          avg_hr: { type: 'NUMBER' },
          effort: { type: 'STRING', enum: ['easy', 'steady', 'pushed', 'all_out'] },
          body: { type: 'STRING', enum: ['fresh', 'okay', 'heavy'] },
          amount: { type: 'STRING', enum: ['could_take_more', 'right', 'stretch', 'over_the_line'] },
          level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          notes: { type: 'STRING' },
        },
        required: ['type', 'confidence'],
      },
    },
  },
  required: ['actions'],
}

export interface InterpretResult {
  ai_action_id: string | null
  applied: Record<string, any>[]
  suggestions: Record<string, any>[]
  answers: string[] // read-only question replies; no DB writes, no undo entry
  error?: string
  raw_actions?: Record<string, any>[] // what the model actually emitted - for debugging misparses
}

function daysAgo(date: string, today: string): string {
  const diff = Math.round((new Date(today + 'T00:00:00Z').getTime() - new Date(date + 'T00:00:00Z').getTime()) / 86400000)
  return diff === 0 ? 'today' : diff === 1 ? 'yesterday' : `${diff} days ago (${date})`
}

/** Parse free text into actions and apply them for the given user.
 *  `time` is the user's local clock (HH:MM) so relative times resolve. */
export async function interpretAndApply(
  supabase: any,
  userId: string,
  text: string,
  date: string,
  weekday: number,
  time?: string,
): Promise<InterpretResult> {
  // Today's candidate tasks (small list) get injected into the prompt so the
  // model fuzzy-matches natively - no vector store needed at this scale.
  const { data: routines } = await supabase
    .from('routines')
    .select('id, name, tasks(id, label, tier, scheduled_days)')
    .eq('user_id', userId)
    .eq('active', true)
  const taskIds = (routines ?? []).flatMap((r: any) => (r.tasks ?? []).map((t: any) => t.id))
  const { data: logs } = await supabase
    .from('task_logs')
    .select('task_id, status')
    .eq('date', date)
    .in('task_id', taskIds)
  const logByTask = new Map((logs ?? []).map((l: any) => [l.task_id, l.status]))

  const candidates: { id: string; label: string; routine: string; status: string }[] = []
  const allTasks: { id: string; label: string }[] = []
  for (const r of routines ?? []) {
    for (const t of r.tasks ?? []) {
      allTasks.push({ id: t.id, label: t.label })
      if (!t.scheduled_days?.includes(weekday)) continue
      candidates.push({ id: t.id, label: t.label, routine: r.name, status: (logByTask.get(t.id) as string) ?? 'pending' })
    }
  }
  const categories = (routines ?? []).map((r: any) => r.name).join(', ')

  // open reminders, so "bought the sunscreen" can clear the matching one
  const { data: pendingReminders } = await supabase
    .from('reminders')
    .select('id, raw_text, status, due_date, due_time')
    .eq('user_id', userId)
    .in('status', ['auto', 'reassigned'])
    .order('created_at', { ascending: false })
    .limit(30)

  const prompt = `You are the input parser for an AuDHD-friendly routine tracker.
Parse the user's message into zero or more actions. The message may contain several intents at once.

Today's tasks (only ever reference these exact task_id values):
${candidates.map((c) => `- task_id=${c.id} | ${c.routine} | ${c.label} | currently: ${c.status}`).join('\n')}

Routine categories for reminders: ${categories}, Other

Open reminders (only ever reference these exact reminder_id values):
${(pendingReminders ?? []).map((r: any) => `- reminder_id=${r.id} | ${r.raw_text}${r.due_date ? ` | due ${r.due_date}${r.due_time ? ' ' + String(r.due_time).slice(0, 5) : ''}` : ''}`).join('\n') || '(none)'}

All tasks, any day (for query_last_done questions and past-day check_task):
${allTasks.map((t) => `- task_id=${t.id} | ${t.label}`).join('\n')}

Rules:
- check_task: match mentions of completed activities to task_ids above (fuzzy match is expected,
  e.g. "meds" matches a medication task). status "done" unless the user says partial/skipped.
  "did X except Y" means all tasks of routine X are done and Y is skipped.
  Set confidence 0-1 for how certain the match is.
  For a PAST day ("did the dishes yesterday") set days_ago (1 = yesterday, max 7) and match
  against the all-tasks list.
- log_workout: gym set logging like "bench 60kg 3x8" -> exercise name, sets array (3x8 at 60kg =
  three entries of {kg:60, reps:8}), plus notes if any commentary.
- log_cardio: runs/walks/cycling -> kind, minutes, distance_km, notes. Capture BOTH numbers
  when both are said: "ran 5km in 32 min" -> {kind:"run", distance_km:5, minutes:32}.
  "5k"/"5 k" means distance_km:5. Not for lifting. Heart rate ("152 bpm") -> avg_hr: 152.
  When the user says how it felt, also set effort (easy|steady|pushed|all_out),
  body (fresh|okay|heavy) and/or amount (could_take_more|right|stretch|over_the_line).
- create_reminder: future to-dos ("remind me to...", "I need to..."). Put the cleaned-up task in
  reminder_text and pick the best category. Set confidence for the category choice.
  Emit exactly ONE create_reminder per distinct to-do — never several copies of the same item.
  If the message names a deadline ("by Friday", "tomorrow", "on the 15th"), set due_date as
  yyyy-mm-dd resolved against today: ${date} (ISO weekday ${weekday}, 1=Mon). Omit if no date.
  If it names a clock time ("at 5pm", "at 17:30"), ALWAYS set due_time as HH:MM (24h); a bare
  time means due_date is today.
  If it names a RELATIVE time ("in 10 mins", "in two hours"), ALWAYS set due_in_minutes to
  the number of minutes from now (integer) — do NOT compute a clock time yourself.
  Examples: "drink water at 14:20" -> {type:"create_reminder", reminder_text:"Drink water",
  due_date:"${date}", due_time:"14:20"}; "drink water in 10 mins" ->
  {type:"create_reminder", reminder_text:"Drink water", due_in_minutes:10}.
- complete_reminder: the user says a held reminder happened or is no longer needed
  ("bought the sunscreen", "forget the dentist thing"). Set reminder_id from the open
  reminders list and reminder_status: "done" (it happened) or "dismissed" (not needed).
  Never invent reminder_ids; if nothing clearly matches, don't emit this action.
- set_energy: statements about today's capacity/energy ("low energy today", "feeling great").
- query_last_done: QUESTIONS about when a task last happened ("when did I last refill?").
  Match against the all-tasks list; nothing is written, an answer comes back.
- query_reminders: QUESTIONS about what's pending or due ("what's on my list?",
  "anything due today?"). Nothing is written, an answer comes back.
- query_last_workout: questions about lifting history ("what did I bench last time?") ->
  put the exercise name in exercise.
- If nothing actionable, return an empty actions array. Never invent task_ids.

User message: "${text}"`

  let parsed: { actions?: Record<string, any>[] } | null = null
  let lastError = ''
  for (const model of GEMINI_MODELS) {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // maxOutputTokens caps runaway repetition; a real parse needs far less
          generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0, maxOutputTokens: 2048 },
        }),
      },
    )
    if (geminiRes.ok) {
      const gemini = await geminiRes.json()
      try {
        parsed = JSON.parse(gemini.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"actions":[]}')
        break
      } catch {
        // the model rambled past the token cap and truncated its JSON -
        // that model failed, try the next one
        lastError = `${model}: truncated/unparseable JSON output`
        continue
      }
    }
    lastError = `${model}: ${await geminiRes.text()}`
    // overload / quota / a retired model name are per-model - try the next
    // one; anything else is fatal
    if (geminiRes.status !== 503 && geminiRes.status !== 429 && geminiRes.status !== 404) break
  }
  if (!parsed) return { ai_action_id: null, applied: [], suggestions: [], answers: [], error: `Gemini error: ${lastError}` }

  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  const taskById = new Map(allTasks.map((t) => [t.id, t]))
  const routineByName = new Map((routines ?? []).map((r: any) => [r.name.toLowerCase(), r.id]))
  const applied: Record<string, any>[] = []
  const suggestions: Record<string, any>[] = []
  const answers: string[] = []

  // periodization context, fetched lazily on the first log_workout
  let planContext: { plans: any[]; week: number | null } | null = null
  async function getPlanContext() {
    if (planContext) return planContext
    const [{ data: plans }, { data: block }, { data: settings }, { data: first }] = await Promise.all([
      supabase.from('workout_plans').select('split_day, exercise, schemes').eq('user_id', userId),
      supabase
        .from('training_blocks')
        .select('start_date')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('user_settings').select('program_start').eq('user_id', userId).maybeSingle(),
      supabase
        .from('workout_logs')
        .select('date')
        .eq('user_id', userId)
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])
    // one clock: the active block's start wins, then the Gym tab's picked
    // week (program_start), then the first-ever log
    const start = block?.start_date ?? settings?.program_start ?? first?.date
    const week = start
      ? Math.max(1, Math.floor((new Date(date + 'T00:00:00Z').getTime() - new Date(start + 'T00:00:00Z').getTime()) / (7 * 86400000)) + 1)
      : null
    planContext = { plans: plans ?? [], week }
    return planContext
  }

  const seenReminders = new Set<string>()
  const reminderActionCount = (parsed.actions ?? []).filter((a: any) => a.type === 'create_reminder').length
  // the caller's local clock; old clients don't send it, so it's resolved
  // lazily from the user's stored timezone the first time it's needed
  let nowTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(time ?? '') ? (time as string) : ''
  const resolveNow = async (): Promise<string> => {
    if (nowTime) return nowTime
    const { data: settings } = await supabase
      .from('user_settings')
      .select('timezone')
      .eq('user_id', userId)
      .maybeSingle()
    const { minutes } = userNow(settings?.timezone)
    nowTime = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
    return nowTime
  }
  // the lite models sometimes emit the same action several times in one
  // reply - identical copies are dropped, and a runaway list is capped
  const seenActions = new Set<string>()
  for (const action of (parsed.actions ?? []).slice(0, 10)) {
    const actKey = JSON.stringify(action)
    if (seenActions.has(actKey)) continue
    seenActions.add(actKey)
    const confidence = typeof action.confidence === 'number' ? action.confidence : 1

    if (action.type === 'check_task') {
      let daysAgo = clampDaysAgo(action.days_ago)
      // deterministic fallback: the lite models tend to drop days_ago even
      // when the message plainly says yesterday
      if (daysAgo === 0 && mentionsYesterday(text)) daysAgo = 1
      // past days may reference tasks that aren't scheduled today
      const candidate = candidateById.get(action.task_id) ?? (daysAgo > 0 ? taskById.get(action.task_id) : undefined)
      if (!candidate || confidence < SUGGEST_THRESHOLD) continue
      const status = action.status ?? 'done'
      if (confidence < APPLY_THRESHOLD) {
        suggestions.push({ type: 'check_task', task_id: candidate.id, label: candidate.label, status, confidence })
        continue
      }
      const logDate = daysAgo > 0 ? addDays(date, -daysAgo) : date
      const { data: log, error } = await supabase
        .from('task_logs')
        .upsert(
          { task_id: candidate.id, date: logDate, status, completed_via: 'ai_text', notes: action.notes ?? null, logged_at: new Date().toISOString() },
          { onConflict: 'task_id,date' },
        )
        .select('id')
        .single()
      if (!error) applied.push({ type: 'check_task', task_id: candidate.id, label: candidate.label, status, log_id: log.id, log_date: logDate })
    } else if (action.type === 'log_workout') {
      if (!action.exercise) continue
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

      // a planned session opened today takes the sets first (Session Player /
      // Telegram parity); anything else falls through to the freeform log
      const { data: openSession } = await supabase
        .from('planned_sessions')
        .select('id, split_day')
        .eq('user_id', userId)
        .eq('date', date)
        .is('completed_at', null)
        .limit(1)
        .maybeSingle()
      if (openSession && Array.isArray(action.sets) && action.sets.length > 0) {
        const { data: openSets } = await supabase
          .from('planned_sets')
          .select('id, exercise')
          .eq('session_id', openSession.id)
          .is('logged_at', null)
          .order('sort_order')
        const matching = (openSets ?? []).filter(
          (s: any) => norm(s.exercise).includes(norm(action.exercise)) || norm(action.exercise).includes(norm(s.exercise)),
        )
        if (matching.length > 0) {
          const filled: string[] = []
          for (let i = 0; i < action.sets.length && i < matching.length; i++) {
            const { error } = await supabase
              .from('planned_sets')
              .update({ logged_weight: action.sets[i].kg, logged_reps: action.sets[i].reps, logged_at: new Date().toISOString() })
              .eq('id', matching[i].id)
            if (!error) filled.push(matching[i].id)
          }
          if (filled.length > 0) {
            const { count } = await supabase
              .from('planned_sets')
              .select('id', { count: 'exact', head: true })
              .eq('session_id', openSession.id)
              .is('logged_at', null)
            if ((count ?? 1) === 0) {
              await supabase.from('planned_sessions').update({ completed_at: new Date().toISOString() }).eq('id', openSession.id)
            }
            applied.push({
              type: 'log_workout',
              exercise: matching[0].exercise,
              sets: action.sets.slice(0, filled.length),
              planned_set_ids: filled,
              split_day: openSession.split_day,
            })
            continue
          }
        }
      }

      // infer split_day + target_scheme from the plan, week from the first log
      const { plans, week } = await getPlanContext()
      const plan = plans.find(
        (p) => norm(p.exercise).includes(norm(action.exercise)) || norm(action.exercise).includes(norm(p.exercise)),
      )
      const phase = week === null ? null : week <= 2 ? '1-2' : week <= 4 ? '3-4' : week <= 6 ? '5-6' : null
      const { data: row, error } = await supabase
        .from('workout_logs')
        .insert({
          user_id: userId,
          date,
          exercise: action.exercise,
          sets: action.sets ?? null,
          notes: action.notes ?? null,
          week_number: week,
          split_day: plan?.split_day ?? null,
          target_scheme: (phase && plan?.schemes?.[phase]) ?? null,
        })
        .select('id')
        .single()
      if (!error) applied.push({ type: 'log_workout', workout_log_id: row.id, exercise: action.exercise, sets: action.sets ?? null })
    } else if (action.type === 'log_cardio') {
      // deterministic safety net: models sometimes drop one of the numbers
      let distanceKm = action.distance_km ?? null
      let minutes = action.minutes ?? null
      if (distanceKm == null) {
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:km|kms|k\b)/i)
        if (m) distanceKm = parseFloat(m[1].replace(',', '.'))
      }
      if (minutes == null) {
        const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:min|mins|minutes|minutos)/i)
        if (m) minutes = parseFloat(m[1].replace(',', '.'))
      }
      const avgHr = normalizeAvgHr(action.avg_hr) ?? parseBpm(text)
      const pick = (v: unknown, allowed: string[]) => (allowed.includes(String(v)) ? String(v) : null)
      const { data: row, error } = await supabase
        .from('cardio_logs')
        .insert({
          user_id: userId,
          date,
          kind: action.kind ?? 'run',
          minutes,
          distance_km: distanceKm,
          avg_hr: avgHr,
          notes: action.notes ?? null,
          effort: pick(action.effort, ['easy', 'steady', 'pushed', 'all_out']),
          body: pick(action.body, ['fresh', 'okay', 'heavy']),
          amount: pick(action.amount, ['could_take_more', 'right', 'stretch', 'over_the_line']),
        })
        .select('id')
        .single()
      if (!error)
        applied.push({
          type: 'log_cardio',
          cardio_log_id: row.id,
          kind: action.kind ?? 'run',
          minutes,
          distance_km: distanceKm,
          avg_hr: avgHr,
        })
    } else if (action.type === 'create_reminder') {
      const reminderText = action.reminder_text ?? text
      // the model sometimes emits the same reminder several times in one
      // message - the first copy wins, the rest are dropped
      const dupeKey = reminderText.trim().toLowerCase()
      if (seenReminders.has(dupeKey)) continue
      seenReminders.add(dupeKey)
      const category = action.category ?? 'Other'
      const routineId = routineByName.get(category.toLowerCase()) ?? null
      let dueDate = /^\d{4}-\d{2}-\d{2}$/.test(action.due_date ?? '') ? action.due_date : null
      // tolerate sloppy model output: "9:30", "17:30:00", numbers as strings
      let dueTime = normalizeDueTime(action.due_time)
      let dueInMin = normalizeDueInMinutes(action.due_in_minutes)
      // deterministic fallback: when the model named no time/date but the
      // message plainly does, parse it here so "in 10 mins" / "at 5pm" /
      // "tomorrow" never gets lost (only when this is the message's single
      // reminder - no ambiguity about which one the phrase belongs to)
      if (reminderActionCount === 1) {
        if (!dueTime && dueInMin === null) {
          dueInMin = parseRelativeMinutes(text)
          if (dueInMin === null) dueTime = parseAbsoluteTime(text)
        }
        if (!dueDate && dueInMin === null) {
          const day = parseRelativeDay(text)
          if (day === 'tomorrow') dueDate = addDays(date, 1)
          else if (day === 'today') dueDate = date
        }
      }
      // "in 10 mins": the model reports the offset, the clock math happens here
      if (!dueTime && dueInMin !== null) {
        const rolled = addMinutesToClock(await resolveNow(), dueInMin)
        dueTime = rolled.time
        dueDate = dueDate ?? addDays(date, rolled.dayOffset) // rolls past midnight
      }
      dueDate = dueDate ?? (dueTime ? date : null) // a bare time means today
      const { data: row, error } = await supabase
        .from('reminders')
        .insert({
          user_id: userId,
          raw_text: reminderText,
          ai_category: category,
          final_category: category,
          ai_confidence: confidence,
          routine_id: routineId,
          due_date: dueDate,
          due_time: dueTime,
        })
        .select('id')
        .single()
      if (!error) applied.push({ type: 'create_reminder', reminder_id: row.id, text: reminderText, category, due_date: dueDate, due_time: dueTime })
    } else if (action.type === 'complete_reminder') {
      // status change only, never a delete - and fully undoable via prev_status
      const target = (pendingReminders ?? []).find((r: any) => r.id === action.reminder_id)
      if (!target || confidence < APPLY_THRESHOLD) continue // high bar: wrong clears are annoying
      const newStatus = action.reminder_status === 'dismissed' ? 'dismissed' : 'done'
      const { error } = await supabase
        .from('reminders')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', target.id)
        .eq('user_id', userId)
      if (!error)
        applied.push({
          type: 'complete_reminder',
          reminder_id: target.id,
          text: target.raw_text,
          reminder_status: newStatus,
          prev_status: target.status,
        })
    } else if (action.type === 'query_reminders') {
      const items = pendingReminders ?? []
      answers.push(
        items.length === 0
          ? 'Nothing on hold.'
          : `On hold: ${items
              .map(
                (r: any) =>
                  r.raw_text +
                  (r.due_date ? ` (by ${r.due_date}${r.due_time ? ' ' + String(r.due_time).slice(0, 5) : ''})` : ''),
              )
              .join('; ')}.`,
      )
    } else if (action.type === 'set_energy') {
      if (!action.level) continue
      const { error } = await supabase
        .from('daily_state')
        .upsert({ user_id: userId, date, energy: action.level }, { onConflict: 'user_id,date' })
      if (!error) applied.push({ type: 'set_energy', level: action.level })
    } else if (action.type === 'query_last_done') {
      const task = taskById.get(action.task_id)
      if (!task) continue
      const { data: last } = await supabase
        .from('task_logs')
        .select('date, status')
        .eq('task_id', task.id)
        .in('status', ['done', 'partial'])
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      answers.push(last ? `${task.label}: last done ${daysAgo(last.date, date)}.` : `${task.label}: no record of it yet.`)
    } else if (action.type === 'query_last_workout') {
      if (!action.exercise) continue
      const { data: last } = await supabase
        .from('workout_logs')
        .select('date, exercise, sets, notes')
        .eq('user_id', userId)
        .ilike('exercise', `%${action.exercise}%`)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!last) {
        answers.push(`${action.exercise}: nothing logged yet.`)
      } else {
        const sets = last.sets?.map((s: { kg: number; reps: number }) => `${s.kg}kg×${s.reps}`).join(', ')
        answers.push(`${last.exercise}, ${daysAgo(last.date, date)}${sets ? `: ${sets}` : ''}.`)
      }
    }
  }

  let aiActionId: string | null = null
  if (applied.length > 0) {
    const { data: row } = await supabase
      .from('ai_actions')
      .insert({ user_id: userId, raw_text: text, actions: applied })
      .select('id')
      .single()
    aiActionId = row?.id ?? null
  }

  return { ai_action_id: aiActionId, applied, suggestions, answers, raw_actions: parsed.actions ?? [] }
}

/** One line of plain text per applied action - for chat replies. */
export function describeApplied(a: Record<string, any>): string {
  switch (a.type) {
    case 'check_task':
      return `${a.status === 'skipped' ? '⏭' : '✓'} ${a.label}`
    case 'log_workout': {
      const sets = a.sets?.map((s: { kg: number; reps: number }) => `${s.kg}kg×${s.reps}`).join(', ')
      const planned = a.planned_set_ids ? ` → ${a.split_day} session` : ''
      return `🏋️ ${a.exercise}${sets ? ` — ${sets}` : ''}${planned}`
    }
    case 'log_cardio':
      return `🏃 ${a.kind}${a.distance_km ? ` ${a.distance_km}km` : ''}${a.minutes ? ` · ${a.minutes} min` : ''}`
    case 'create_reminder':
      return `🔔 ${a.text} → ${a.category}${a.due_date ? ` (by ${a.due_date}${a.due_time ? ` ${a.due_time}` : ''})` : ''}`
    case 'complete_reminder':
      return `✓ ${a.reminder_status === 'dismissed' ? 'dropped' : 'cleared'}: ${a.text}`
    case 'set_energy':
      return `🔋 Energy: ${a.level}`
    default:
      return ''
  }
}
