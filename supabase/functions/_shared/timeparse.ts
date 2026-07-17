// Deterministic time/date parsing for the interpret core. Everything here is
// a pure function with no Deno APIs, so the same file is unit-tested from
// vitest (tests/timeparse.test.ts) and imported by the edge functions.
//
// The design rule these encode: anything time-shaped is never left to the
// model's arithmetic. The model points at tasks and reminders; clocks and
// calendars are resolved here.

/** Persian (۰-۹) and Arabic-Indic (٠-٩) digits -> ASCII, so the numeric
 *  regexes below read "۵ کیلومتر" the same as "5 km". */
export function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

/** Model-emitted time in any sloppy shape ("9:30", "17:30:00") -> "HH:MM", else null. */
export function normalizeDueTime(raw: unknown): string | null {
  const m = String(raw ?? '').match(/^(\d{1,2}):([0-5]\d)(?::\d{2})?$/)
  if (!m || Number(m[1]) >= 24) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

// The relative/absolute fallbacks below only run when the model already
// decided the message is a reminder and dropped the time fields, so a broad
// multilingual net is safe: it can only recover a time, not invent an intent.
// \b does not work around non-Latin scripts, so those tokens match bare.

const MIN_WORDS = 'min|mins|minute|minutes|minuten|minutos?|دقیقه|دقايق|دقائق|دقيقة|分钟|分'
const HOUR_WORDS = 'h|hr|hrs|hour|hours|heures?|horas?|stunden?|ساعت|ساعات|ساعة|小时|個小時|个小时'

/** "in 10 mins" / "dans 10 min" / "بعد 10 دقائق" / "10分钟后" -> minutes from now, else null. */
export function parseRelativeMinutes(text: string): number | null {
  const t = normalizeDigits(text)
  const m =
    t.match(new RegExp(`\\b(?:in|dans|en)\\s+(\\d+)\\s*(${MIN_WORDS}|${HOUR_WORDS})\\b`, 'i')) ??
    t.match(new RegExp(`(?:بعد|طی)\\s*(\\d+)\\s*(${MIN_WORDS}|${HOUR_WORDS})`, 'i')) ??
    t.match(new RegExp(`(\\d+)\\s*(${MIN_WORDS}|${HOUR_WORDS})\\s*(?:دیگر|بعد|后|後)`, 'i'))
  if (!m) return null
  return Number(m[1]) * (new RegExp(`^(?:${HOUR_WORDS})$`, 'i').test(m[2]) ? 60 : 1)
}

/** "at 5pm" / "à 17h30" / "um 17:30" / "ساعت ۱۸" / "下午5点" -> "HH:MM", else null. */
export function parseAbsoluteTime(text: string): string | null {
  const t = normalizeDigits(text)
  const m =
    // (?:^|\s) instead of \b: word boundaries don't exist next to "à"
    t.match(/(?:^|\s)(?:at|à|um|a las|a la)\s+(\d{1,2})(?:[:h]([0-5]\d))?\s*(am|pm)?\b/i) ??
    t.match(/(?:ساعت|الساعة|الساعه)\s*(\d{1,2})(?::([0-5]\d))?/) ??
    t.match(/(上午|下午|晚上)?\s*(\d{1,2})\s*[点點](?:([0-5]\d)分?)?/)
  if (!m) return null
  // the Chinese pattern puts its am/pm marker first; normalize the groups
  const zh = m.length === 4 && (m[1] === '上午' || m[1] === '下午' || m[1] === '晚上' || /[点點]/.test(m[0]))
  let h = Number(zh ? m[2] : m[1])
  const min = Number((zh ? m[3] : m[2]) ?? 0)
  const ap = zh ? (m[1] === '下午' || m[1] === '晚上' ? 'pm' : m[1] === '上午' ? 'am' : undefined) : m[3]?.toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h >= 24 || Number.isNaN(h)) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

const TOMORROW = /\b(tomorrow|demain|mañana|morgen)\b/i
const TOMORROW_BARE = ['فردا', 'غدا', 'غدًا', 'غداً', '明天', '明早', '明晚']
const TODAY = /\b(today|tonight|aujourd'hui|aujourd’hui|ce soir|hoy|esta noche|heute|heute abend)\b/i
const TODAY_BARE = ['امروز', 'امشب', 'اليوم', 'الليلة', '今天', '今晚']

/** "tomorrow" / "today" / "tonight" (any pack language) anywhere in the text, else null. */
export function parseRelativeDay(text: string): 'tomorrow' | 'today' | null {
  if (TOMORROW.test(text) || TOMORROW_BARE.some((w) => text.includes(w))) return 'tomorrow'
  if (TODAY.test(text) || TODAY_BARE.some((w) => text.includes(w))) return 'today'
  return null
}

const YESTERDAY = /\b(yesterday|hier|ayer|gestern)\b/i
const YESTERDAY_BARE = ['دیروز', 'دیشب', 'أمس', 'امس', 'البارحة', '昨天', '昨晚']

/** True when the text plainly reports a past day ("did X yesterday"). */
export function mentionsYesterday(text: string): boolean {
  return YESTERDAY.test(text) || YESTERDAY_BARE.some((w) => text.includes(w))
}

/** "HH:MM" + N minutes -> the new clock time and how many days it rolled over. */
export function addMinutesToClock(nowHHMM: string, addMin: number): { time: string; dayOffset: number } {
  const [h, m] = nowHHMM.split(':').map(Number)
  const total = h * 60 + m + addMin
  const mm = ((total % 1440) + 1440) % 1440
  return {
    time: `${String(Math.floor(mm / 60)).padStart(2, '0')}:${String(mm % 60).padStart(2, '0')}`,
    dayOffset: Math.floor(total / 1440),
  }
}

/** Model-emitted days_ago in any shape -> integer clamped to 0..7. */
export function clampDaysAgo(raw: unknown): number {
  const n = Number(raw)
  return Number.isFinite(n) ? Math.min(7, Math.max(0, Math.round(n))) : 0
}

/** Model-emitted due_in_minutes in any shape -> positive integer, else null. */
export function normalizeDueInMinutes(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** "152 bpm" anywhere in the text -> 152; sanity-bounded, else null. */
export function parseBpm(text: string): number | null {
  const m = normalizeDigits(text).match(/(\d{2,3})\s*bpm\b/i)
  if (!m) return null
  const n = Number(m[1])
  return n > 30 && n < 250 ? n : null
}

/** Model-emitted avg_hr in any shape -> sanity-bounded integer, else null. */
export function normalizeAvgHr(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 30 && n < 250 ? Math.round(n) : null
}
