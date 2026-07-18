// Weekly training review: one Gemini pass per user per week that (a) names
// the clearest trend across ~12 weeks of strength + cardio and (b) suggests
// small, safe adjustments for the coming week based on last week's sets,
// reps, muscle volume and logged feedback. Stored in training_reviews; the
// app only displays it - advice is never auto-applied to the plan.
//
// Called from weekly-reflection's per-user loop (service role), so every
// query scopes by user_id explicitly. Self-healing: any pass that finds no
// row for the current week generates one, so a missed Monday tick catches
// up on the next pass instead of skipping the week.

// deno-lint-ignore-file no-explicit-any

import { GEMINI_MODELS } from './interpret.ts'
import { LANGUAGE_NAMES } from './lang.ts'
import type { Lang } from './lang.ts'
import { addDays } from './localtime.ts'

const WEEKS = 12

const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const r1 = (n: number) => Math.round(n * 10) / 10
const trend = (first: number, last: number) => {
  if (first === 0 && last === 0) return 'flat'
  const change = last - first
  const rel = first ? change / first : 1
  if (Math.abs(rel) < 0.12) return 'steady'
  return change > 0 ? 'up' : 'down'
}

const reviewSchema = {
  type: 'OBJECT',
  properties: {
    pattern: { type: 'STRING' },
    advice: { type: 'STRING' },
  },
  required: ['pattern', 'advice'],
}

/** Generate and store this week's training review unless it already exists.
 *  Returns true when a review was written. `weekStart` is the user-local
 *  Monday of the CURRENT week; the detailed analysis covers the week before. */
export async function maybeTrainingReview(
  supabase: any,
  userId: string,
  lang: Lang,
  weekStart: string,
  force = false,
): Promise<boolean> {
  if (!force) {
    const { data: existing } = await supabase
      .from('training_reviews')
      .select('id')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .maybeSingle()
    if (existing) return false
  }

  const windowStart = addDays(weekStart, -7 * WEEKS) // 12 full weeks before this one
  const prevStart = addDays(weekStart, -7)
  const weekIdx = (d: string) => {
    const i = Math.floor(
      (Date.parse(d.slice(0, 10) + 'T00:00:00Z') - Date.parse(windowStart + 'T00:00:00Z')) / (7 * 86400000),
    )
    return i >= 0 && i < WEEKS ? i : -1
  }

  const [sessionsRes, setsRes, cardioRes, checkinRes, lastSetsRes, liftsRes, blockRes, settingsRes] =
    await Promise.all([
      supabase.from('planned_sessions').select('completed_at').eq('user_id', userId)
        .gte('completed_at', windowStart + 'T00:00:00').lt('completed_at', weekStart + 'T00:00:00')
        .not('completed_at', 'is', null),
      supabase.from('planned_sets').select('logged_at, muscle_group').eq('user_id', userId)
        .gte('logged_at', windowStart + 'T00:00:00').lt('logged_at', weekStart + 'T00:00:00')
        .not('logged_reps', 'is', null),
      supabase.from('cardio_logs').select('date, kind, distance_km, minutes, avg_hr, effort, body, amount').eq('user_id', userId)
        .gte('date', windowStart).lt('date', weekStart),
      supabase.from('recovery_checkins').select('created_at, muscle_group, recovery, effort, amount').eq('user_id', userId)
        .gte('created_at', prevStart + 'T00:00:00').lt('created_at', weekStart + 'T00:00:00'),
      supabase.from('planned_sets')
        .select('exercise, muscle_group, target_scheme, target_weight, logged_weight, logged_reps').eq('user_id', userId)
        .gte('logged_at', prevStart + 'T00:00:00').lt('logged_at', weekStart + 'T00:00:00')
        .not('logged_reps', 'is', null),
      supabase.from('workout_logs').select('exercise, muscle_group, sets').eq('user_id', userId)
        .gte('date', prevStart).lt('date', weekStart),
      supabase.from('training_blocks').select('block, start_date, total_weeks').eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('user_settings').select('cardio_target_km').eq('user_id', userId).maybeSingle(),
    ])
  // the written plan itself, so advice can speak to it (fetched after
  // blockRes since the snapshot should be the active block's plan; with no
  // block running, their block-1 plan still gives the advice something real
  // to anchor to - custom "build your own" plans live in the same table)
  const plansRes = await supabase.from('workout_plans')
    .select('split_day, exercise, muscle_group, schemes, cardio')
    .eq('user_id', userId).eq('block', blockRes.data?.block ?? 1).order('sort_order')

  // ---- 12-week series (the trend context) ----
  const sessions = Array(WEEKS).fill(0)
  const sets = Array(WEEKS).fill(0)
  const cardioKm = Array(WEEKS).fill(0)
  for (const s of sessionsRes.data ?? []) { const i = weekIdx(s.completed_at); if (i >= 0) sessions[i]++ }
  for (const s of setsRes.data ?? []) { const i = weekIdx(s.logged_at); if (i >= 0) sets[i]++ }
  for (const c of cardioRes.data ?? []) { const i = weekIdx(c.date); if (i >= 0) cardioKm[i] += Number(c.distance_km ?? 0) }

  const activity = sessions.map((_, i) => sessions[i] + sets[i] + (cardioKm[i] > 0 ? 1 : 0))
  const activeWeeks = activity.filter((n) => n > 0).length
  if (activeWeeks < 2) return false // a pattern needs at least two active weeks

  // weeks before logging began are unknown time, not rest - drop them so the
  // model can't read the start of logging as a training spike
  const firstActive = activity.findIndex((n) => n > 0)
  const span = WEEKS - firstActive
  const wSessions = sessions.slice(firstActive)
  const wSets = sets.slice(firstActive)
  const wCardioKm = cardioKm.slice(firstActive)
  const wActivity = activity.slice(firstActive)
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

  // ---- last week in detail ----
  type SetRow = { exercise: string; muscle_group: string | null; target_scheme: string | null; logged_weight: number | null; logged_reps: number | null }
  const byExercise = new Map<string, SetRow[]>()
  for (const s of (lastSetsRes.data ?? []) as SetRow[]) {
    byExercise.set(s.exercise, [...(byExercise.get(s.exercise) ?? []), s])
  }
  const range = (nums: number[]) => {
    const lo = Math.min(...nums)
    const hi = Math.max(...nums)
    return lo === hi ? `${r1(lo)}` : `${r1(lo)}-${r1(hi)}`
  }
  const exerciseLines = [...byExercise.entries()].map(([ex, rows]) => {
    const reps = rows.map((s) => s.logged_reps!).filter((n) => n != null)
    const kgs = rows.map((s) => Number(s.logged_weight)).filter((n) => n > 0)
    const target = rows.find((s) => s.target_scheme)?.target_scheme
    return `- ${ex} (${rows[0].muscle_group ?? '?'}): ${rows.length} sets, reps ${range(reps)}${kgs.length ? ` @ ${range(kgs)} kg` : ''}${target ? ` (target ${target})` : ''}`
  })
  for (const w of liftsRes.data ?? []) {
    const setsArr = (w.sets ?? []) as { kg?: number; reps?: number }[]
    const reps = setsArr.map((s) => s.reps ?? 0).filter(Boolean)
    const kgs = setsArr.map((s) => s.kg ?? 0).filter(Boolean)
    exerciseLines.push(
      `- ${w.exercise} (${w.muscle_group ?? '?'}, off-plan): ${setsArr.length} sets${reps.length ? `, reps ${range(reps)}` : ''}${kgs.length ? ` @ ${range(kgs)} kg` : ''}`,
    )
  }

  // hard sets per muscle, last week (planned + off-plan)
  const muscleSets = new Map<string, number>()
  for (const s of (lastSetsRes.data ?? []) as SetRow[]) {
    if (s.muscle_group) muscleSets.set(s.muscle_group, (muscleSets.get(s.muscle_group) ?? 0) + 1)
  }
  for (const w of liftsRes.data ?? []) {
    if (w.muscle_group) muscleSets.set(w.muscle_group, (muscleSets.get(w.muscle_group) ?? 0) + ((w.sets ?? []) as unknown[]).length)
  }
  const volumeLine = [...muscleSets.entries()].map(([m, n]) => `${m} ${n}`).join(', ') || 'none logged'

  const feedbackLines = (checkinRes.data ?? []).map(
    (c: any) =>
      `- ${c.muscle_group}: ${[
        c.amount ? `amount "${String(c.amount).replace(/_/g, ' ')}"` : '',
        c.effort ? `effort "${c.effort}"` : '',
        c.recovery ? `recovery "${String(c.recovery).replace(/_/g, ' ')}"` : '',
      ].filter(Boolean).join(', ')}`,
  )

  const lastCardio = (cardioRes.data ?? []).filter((c: any) => c.date >= prevStart)
  const cardioLines = lastCardio.map(
    (c: any) =>
      `- ${c.kind}: ${[
        c.distance_km ? `${r1(Number(c.distance_km))} km` : '',
        c.minutes ? `${Math.round(Number(c.minutes))} min` : '',
        c.avg_hr ? `${c.avg_hr} bpm` : '',
        c.effort ? `effort "${c.effort}"` : '',
        c.body ? `body "${c.body}"` : '',
        c.amount ? `amount "${String(c.amount).replace(/_/g, ' ')}"` : '',
      ].filter(Boolean).join(', ')}`,
  )
  const lastCardioKm = r1(lastCardio.reduce((n: number, c: any) => n + Number(c.distance_km ?? 0), 0))
  const targetKm = settingsRes.data?.cardio_target_km

  const block = blockRes.data
  const blockWeek = block
    ? Math.max(1, Math.min(Math.floor((Date.parse(weekStart) - Date.parse(block.start_date)) / (7 * 86400000)) + 1, block.total_weeks))
    : 0
  const blockLine = block
    ? `They are in week ${blockWeek} of a ${block.total_weeks}-week block (block ${block.block}).`
    : 'They train from a plan but have no active block right now.'

  // the plan as written, with this week's phase scheme (same phase keys the
  // app uses: weeks 1-2 / 3-4 / 5-6)
  const phase = blockWeek <= 2 ? '1-2' : blockWeek <= 4 ? '3-4' : '5-6'
  const bySplit = new Map<string, { line: string; cardio: string | null }[]>()
  for (const p of plansRes.data ?? []) {
    const schemes = (p.schemes ?? {}) as Record<string, string>
    const scheme = schemes[phase] ?? Object.values(schemes)[0] ?? '?'
    bySplit.set(p.split_day, [
      ...(bySplit.get(p.split_day) ?? []),
      { line: `  - ${p.exercise} (${p.muscle_group ?? '?'}): ${scheme}`, cardio: p.cardio ?? null },
    ])
  }
  const planLines = [...bySplit.entries()].map(([day, rows]) => {
    const cardio = rows.find((r) => r.cardio)?.cardio
    return `${day}:\n${rows.map((r) => r.line).join('\n')}${cardio ? `\n  cardio: ${cardio}` : ''}`
  })

  const prompt = `You are a careful strength & conditioning assistant reviewing a recreational
lifter's week. You value joint health and long-term consistency over fast progress.
You never diagnose injuries and never give medical advice.

CONTEXT - weekly series since logging began ${span} week(s) ago, oldest to newest
(earlier time is unknown, NOT rest - never treat the start of logging as a spike):
  gym sessions: [${wSessions.join(', ')}]
  hard sets:    [${wSets.join(', ')}]
  cardio km:    [${wCardioKm.map(r1).join(', ')}]
Average per active week: ${activeAvg(wSessions)} sessions, ${activeAvg(wSets)} hard sets, ${activeAvg(wCardioKm)} km.
Trend (first half vs second half): sessions ${trends.sessions}, hard sets ${trends.sets}, cardio ${trends.cardioKm}.
${blockLine}

THEIR WRITTEN PLAN for this week (sets x reps are the plan's own targets for
the current phase - the plan already periodizes, so a scheme change between
phases is intentional, not a suggestion to make):
${planLines.join('\n') || 'no written plan'}

LAST WEEK (${prevStart} to ${addDays(weekStart, -1)}) in detail:
Strength work:
${exerciseLines.join('\n') || '- none logged'}
Hard sets per muscle: ${volumeLine}
Recovery check-ins after sessions:
${feedbackLines.join('\n') || '- none'}
Cardio:
${cardioLines.join('\n') || '- none logged'}
Cardio total: ${lastCardioKm} km${targetKm ? ` (their easy-week base is ${targetKm} km)` : ''}

Reply with JSON: two string fields, both written in ${LANGUAGE_NAMES[lang]}.

"pattern": 2-3 sentences naming the clearest trend ACROSS the weeks (not one
week alone), using at least one real number or average from the series, and
bringing in logged feedback where it fits. Where it sharpens the point, place
the trend inside their program (which block week they are entering, how the
logged work tracks the written plan). If things trend down or plateau,
say it plainly and without blame - rest is part of training. If only a few
weeks exist, say the pattern is still forming.

"advice": 3 to 5 suggestions for the coming week, each on its own line
starting with "- ". Each one concrete: name the exercise or muscle group
exactly as written in the data, and ground it in a specific number or
feedback entry. Anchor every suggestion to THEIR WRITTEN PLAN above - compare
what was logged against what the plan prescribes (e.g. sets done vs the
written scheme, planned exercises that went untouched, weight relative to the
scheme's rep range) rather than treating the logs as free-floating numbers.
Hard safety rules, in priority order:
1. A muscle whose check-ins said "over the line" (or effort "everything",
   recovery "still worn") gets LESS, never more: one set fewer, longer rest,
   or lighter weight. This overrules every progression rule.
2. Suggest progression only where last week's reps reached the top of the
   target range and the feedback read "right" or "could take more" - and one
   small increment at a time: +2.5 kg OR +1 rep OR +1 set, never several.
3. Cardio: never suggest more than a 10% weekly distance increase. If effort
   was "all out" or body "heavy", suggest holding or easing instead.
4. If most of the week read as strain (stretch/over the line, all-out cardio),
   one suggestion must be about rest or an easier week.
5. If nothing in the data justifies a change, fewer suggestions are better -
   "keep X as it is" is a valid suggestion.
Phrase suggestions as invitations ("try", "consider") - the user applies them
in their plan editor themselves; nothing happens automatically.

Both fields: no exclamation marks, no emoji, no greetings or preamble, no
generic praise ("great job", "keep it up"), and never ${LANGUAGE_NAMES[lang]}
words meaning failed, missed, only, just, should, behind, lazy.`

  let parsed: { pattern?: string; advice?: string } | null = null
  for (const model of GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: reviewSchema, temperature: 0.4, maxOutputTokens: 2048 },
      }),
    })
    if (res.ok) {
      const d = await res.json()
      try {
        parsed = JSON.parse(d.candidates?.[0]?.content?.parts?.[0]?.text ?? '')
      } catch {
        parsed = null
      }
      if (parsed?.pattern && parsed?.advice) break
      parsed = null
      continue // malformed reply - let the next model try
    }
    if (res.status !== 503 && res.status !== 429) break
  }
  if (!parsed?.pattern || !parsed?.advice) return false

  // models sometimes join the "- " bullets with spaces instead of newlines;
  // the UI renders on pre-line, so put each suggestion back on its own line
  let advice = parsed.advice.trim()
  if (!advice.includes('\n')) advice = advice.replace(/\s+- /g, '\n- ')

  await supabase.from('training_reviews').upsert(
    { user_id: userId, week_start: weekStart, body: parsed.pattern.trim(), advice },
    { onConflict: 'user_id,week_start' },
  )
  return true
}
