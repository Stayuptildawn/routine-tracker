// interpret-message: parses free text into structured actions and applies them.
// "took my meds and drank water" -> check off tasks
// "bench 60kg 3x8" -> workout log row
// "remind me to email the lawyer" -> categorized reminder
// "low energy today" -> daily_state energy
//
// Trust rules: confidence >= 0.9 applied immediately (undoable via ai_actions);
// 0.6-0.9 returned as suggestions for one-tap confirm chips; below 0.6 dropped.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Cheapest first; fallbacks cover per-model overload (503) and quota (429).
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.5-flash']
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
          type: { type: 'STRING', enum: ['check_task', 'log_workout', 'create_reminder', 'set_energy'] },
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
          level: { type: 'STRING', enum: ['low', 'medium', 'high'] },
          notes: { type: 'STRING' },
        },
        required: ['type', 'confidence'],
      },
    },
  },
  required: ['actions'],
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
    const { text, date, weekday } = await req.json()
    if (!text || !date || !weekday) return json({ error: 'text, date and weekday are required' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    )
    const { data: auth } = await supabase.auth.getUser()
    if (!auth?.user) return json({ error: 'not authenticated' }, 401)

    // Today's candidate tasks (small list) get injected into the prompt so the
    // model fuzzy-matches natively - no vector store needed at this scale.
    const [{ data: routines }, { data: logs }] = await Promise.all([
      supabase.from('routines').select('id, name, tasks(id, label, tier, scheduled_days)'),
      supabase.from('task_logs').select('task_id, status').eq('date', date),
    ])
    const logByTask = new Map((logs ?? []).map((l) => [l.task_id, l.status]))

    const candidates: { id: string; label: string; routine: string; status: string }[] = []
    for (const r of routines ?? []) {
      for (const t of r.tasks ?? []) {
        if (!t.scheduled_days?.includes(weekday)) continue
        candidates.push({ id: t.id, label: t.label, routine: r.name, status: logByTask.get(t.id) ?? 'pending' })
      }
    }
    const categories = (routines ?? []).map((r) => r.name).join(', ')

    const prompt = `You are the input parser for an AuDHD-friendly routine tracker.
Parse the user's message into zero or more actions. The message may contain several intents at once.

Today's tasks (only ever reference these exact task_id values):
${candidates.map((c) => `- task_id=${c.id} | ${c.routine} | ${c.label} | currently: ${c.status}`).join('\n')}

Routine categories for reminders: ${categories}, Other

Rules:
- check_task: match mentions of completed activities to task_ids above (fuzzy match is expected,
  e.g. "meds" matches a medication task). status "done" unless the user says partial/skipped.
  "did X except Y" means all tasks of routine X are done and Y is skipped.
  Set confidence 0-1 for how certain the match is.
- log_workout: gym set logging like "bench 60kg 3x8" -> exercise name, sets array (3x8 at 60kg =
  three entries of {kg:60, reps:8}), plus notes if any commentary.
- create_reminder: future to-dos ("remind me to...", "I need to..."). Put the cleaned-up task in
  reminder_text and pick the best category. Set confidence for the category choice.
  If the message names a deadline ("by Friday", "tomorrow", "on the 15th"), set due_date as
  yyyy-mm-dd resolved against today: ${date} (ISO weekday ${weekday}, 1=Mon). Omit if no date.
- set_energy: statements about today's capacity/energy ("low energy today", "feeling great").
- If nothing actionable, return an empty actions array. Never invent task_ids.

User message: "${text}"`

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
            generationConfig: { responseMimeType: 'application/json', responseSchema, temperature: 0 },
          }),
        },
      )
      if (geminiRes.ok) {
        gemini = await geminiRes.json()
        break
      }
      lastError = `${model}: ${await geminiRes.text()}`
      // overload / quota are per-model - try the next one; anything else is fatal
      if (geminiRes.status !== 503 && geminiRes.status !== 429) break
    }
    if (!gemini) return json({ error: `Gemini error: ${lastError}` }, 502)
    const parsed = JSON.parse(gemini.candidates?.[0]?.content?.parts?.[0]?.text ?? '{"actions":[]}')

    const candidateById = new Map(candidates.map((c) => [c.id, c]))
    const routineByName = new Map((routines ?? []).map((r) => [r.name.toLowerCase(), r.id]))
    const applied: Record<string, unknown>[] = []
    const suggestions: Record<string, unknown>[] = []

    for (const action of parsed.actions ?? []) {
      const confidence = typeof action.confidence === 'number' ? action.confidence : 1

      if (action.type === 'check_task') {
        const candidate = candidateById.get(action.task_id)
        if (!candidate || confidence < SUGGEST_THRESHOLD) continue
        const status = action.status ?? 'done'
        if (confidence < APPLY_THRESHOLD) {
          suggestions.push({ type: 'check_task', task_id: candidate.id, label: candidate.label, status, confidence })
          continue
        }
        const { data: log, error } = await supabase
          .from('task_logs')
          .upsert(
            { task_id: candidate.id, date, status, completed_via: 'ai_text', notes: action.notes ?? null },
            { onConflict: 'task_id,date' },
          )
          .select('id')
          .single()
        if (!error) applied.push({ type: 'check_task', task_id: candidate.id, label: candidate.label, status, log_id: log.id })
      } else if (action.type === 'log_workout') {
        if (!action.exercise) continue
        const { data: row, error } = await supabase
          .from('workout_logs')
          .insert({ date, exercise: action.exercise, sets: action.sets ?? null, notes: action.notes ?? null })
          .select('id')
          .single()
        if (!error) applied.push({ type: 'log_workout', workout_log_id: row.id, exercise: action.exercise, sets: action.sets ?? null })
      } else if (action.type === 'create_reminder') {
        const reminderText = action.reminder_text ?? text
        const category = action.category ?? 'Other'
        const routineId = routineByName.get(category.toLowerCase()) ?? null
        const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(action.due_date ?? '') ? action.due_date : null
        const { data: row, error } = await supabase
          .from('reminders')
          .insert({ raw_text: reminderText, ai_category: category, final_category: category, ai_confidence: confidence, routine_id: routineId, due_date: dueDate })
          .select('id')
          .single()
        if (!error) applied.push({ type: 'create_reminder', reminder_id: row.id, text: reminderText, category, due_date: dueDate })
      } else if (action.type === 'set_energy') {
        if (!action.level) continue
        const { error } = await supabase
          .from('daily_state')
          .upsert({ date, energy: action.level }, { onConflict: 'user_id,date' })
        if (!error) applied.push({ type: 'set_energy', level: action.level })
      }
    }

    let aiActionId: string | null = null
    if (applied.length > 0) {
      const { data: row } = await supabase
        .from('ai_actions')
        .insert({ raw_text: text, actions: applied })
        .select('id')
        .single()
      aiActionId = row?.id ?? null
    }

    return json({ ai_action_id: aiActionId, applied, suggestions })
  } catch (err) {
    return json({ error: String(err) }, 500)
  }
})
