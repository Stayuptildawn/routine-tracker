// Monthly reflection: at the turn of each month, one Gemini pass folds the
// month's weekly reflections and weekly training reviews into a single
// summary paragraph. That paragraph is the long-term memory - the weekly
// rows it was built from are pruned once folded, and only twelve monthly
// rows are kept per user.
//
// Called from weekly-reflection's per-user loop (service role), so every
// query scopes by user_id explicitly. Self-healing: it runs on any pass in
// the first days of a month that finds no row for the month just ended.

// deno-lint-ignore-file no-explicit-any

import { askGemini } from './gemini.ts'
import { LANGUAGE_NAMES } from './lang.ts'
import type { Lang } from './lang.ts'

// same ban list as the weekly reflection - a vague or judging summary is
// worse than none
const FORBIDDEN =
  /\b(failed|failure|missed|only|just|should|behind|lazy|slipped)\b|great job|keep it up|well done|good work|stay(ing)? consistent|consistency/i

// how many days into a new month the catch-up window stays open
const CATCHUP_DAYS = 5
// months of summaries kept per user
const KEEP_MONTHS = 12

/** First day of the month `date` falls in. */
const monthStartOf = (date: string) => date.slice(0, 8) + '01'

/** month_start ± n months (pure string math, timezone-free). */
export function addMonths(monthStart: string, n: number): string {
  const total = Number(monthStart.slice(0, 4)) * 12 + (Number(monthStart.slice(5, 7)) - 1) + n
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}-01`
}

/** Summarize the month that just ended, unless already done. `date` is the
 *  user-local today. Returns true when a summary was written. */
export async function maybeMonthlyReflection(
  supabase: any,
  userId: string,
  lang: Lang,
  date: string,
  force = false,
): Promise<boolean> {
  if (!force && Number(date.slice(8, 10)) > CATCHUP_DAYS) return false
  const thisMonth = monthStartOf(date)
  const monthStart = addMonths(thisMonth, -1) // the month to summarize

  const { data: existing } = await supabase
    .from('monthly_reflections')
    .select('id')
    .eq('user_id', userId)
    .eq('month_start', monthStart)
    .maybeSingle()
  if (existing) return false

  // the month's weekly material, by the Monday each week started on
  const [reflRes, reviewRes] = await Promise.all([
    supabase.from('reflections').select('week_start, body').eq('user_id', userId)
      .gte('week_start', monthStart).lt('week_start', thisMonth).order('week_start'),
    supabase.from('training_reviews').select('week_start, body, advice').eq('user_id', userId)
      .gte('week_start', monthStart).lt('week_start', thisMonth).order('week_start'),
  ])
  const reflections = reflRes.data ?? []
  const reviews = reviewRes.data ?? []
  if (reflections.length === 0 && reviews.length === 0) return false

  const monthName = new Date(monthStart + 'T00:00:00Z').toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  const reflLines = reflections.map((r: any) => `- (week of ${r.week_start}) ${r.body}`)
  const reviewLines = reviews.map((r: any) => `- (week of ${r.week_start}) ${r.body}`)

  const prompt = `You write a compact monthly summary for someone with AuDHD who tracks daily
routines and hybrid strength/running training. Below are the weekly notes the
app generated during ${monthName} - they are the only source; invent nothing.

WEEKLY LIFE REFLECTIONS:
${reflLines.join('\n') || '- none this month'}

WEEKLY TRAINING REVIEWS:
${reviewLines.join('\n') || '- none this month'}

Write ONE paragraph of 3 to 5 sentences in ${LANGUAGE_NAMES[lang]} summarizing
the month as a whole: the throughline across the weeks, not a week-by-week
retelling. Name at least one real routine, exercise or session type exactly as
it appears in the notes, and use at least one real number from them. If the
notes show a change across the month (volume, cardio, a routine settling in),
say it plainly. Close with one calm, forward-looking sentence for the coming
month - an observation or gentle invitation, not an order.

Hard rules: never use ${LANGUAGE_NAMES[lang]} words meaning failed, missed,
only, just, should, behind, lazy. No generic praise (nothing like "great job",
"keep it up", "consistency"). Frame around what happened, not what didn't.
No exclamation marks, no emoji, no preamble - reply with the paragraph in
${LANGUAGE_NAMES[lang]} and nothing else.`

  let body = (await askGemini(prompt, { temperature: 0.5 })).text
  if (!body) return false
  if (FORBIDDEN.test(body)) {
    body = (await askGemini(
      prompt + `\n\nYour previous draft broke the rules (generic or banned wording). Rewrite it: specific names and numbers, no filler.`,
      { temperature: 0.5 },
    )).text
    if (!body || FORBIDDEN.test(body)) return false
  }

  const { error } = await supabase
    .from('monthly_reflections')
    .upsert({ user_id: userId, month_start: monthStart, body: body.trim() }, { onConflict: 'user_id,month_start' })
  if (error) throw error

  // retention, only after the summary landed: keep 12 monthly rows, and drop
  // the weekly rows of months that are now folded into a summary. The month
  // just summarized keeps its weeklies until the NEXT month-end, so the
  // "noticed recently" and coach's-note cards never go blank at the turn.
  await supabase.from('monthly_reflections').delete().eq('user_id', userId)
    .lt('month_start', addMonths(monthStart, -(KEEP_MONTHS - 1)))
  await supabase.from('reflections').delete().eq('user_id', userId).lt('week_start', monthStart)
  await supabase.from('training_reviews').delete().eq('user_id', userId).lt('week_start', monthStart)
  return true
}
