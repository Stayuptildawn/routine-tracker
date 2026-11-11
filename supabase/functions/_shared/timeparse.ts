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

// Month and weekday names, English / Spanish / French / German. Index = month
// number - 1, and ISO weekday - 1. Matched with Unicode-aware edges (WB / WE)
// because \b breaks next to accented letters.
const MONTHS = [
  'january|jan|enero|ene|janvier|janv|januar',
  'february|feb|febrero|février|fevrier|févr|februar',
  'march|mar|marzo|mars|märz',
  'april|apr|abril|abr|avril|avr',
  'may|mayo|mai',
  'june|jun|junio|juin|juni',
  'july|jul|julio|juillet|juil|juli',
  'august|aug|agosto|août|aout',
  'september|sept|sep|septiembre|setiembre|septembre',
  'october|oct|octubre|octobre|oktober|okt',
  'november|nov|noviembre|novembre',
  'december|dec|diciembre|dic|décembre|decembre|déc|dezember|dez',
]
const WEEKDAYS = [
  'monday|lunes|lundi|montag',
  'tuesday|tues|tue|martes|mardi|dienstag',
  'wednesday|weds|miércoles|miercoles|mercredi|mittwoch',
  'thursday|thurs|thur|thu|jueves|jeudi|donnerstag',
  'friday|viernes|vendredi|freitag',
  'saturday|sábado|sabado|samedi|samstag|sonnabend',
  'sunday|domingo|dimanche|sonntag',
]
// short forms that are also ordinary words ("sat down", "sun cream", French
// "mon"): only read as a day right after a word like "on" or "next"
const WEEKDAYS_SHORT = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MONTH_ALT = MONTHS.join('|')
const WB = '(?<![\\p{L}\\d])'
const WE = '(?![\\p{L}\\d])'

/** "at 5pm" / "à 17h30" / "um 17:30" / "ساعت ۱۸" / "下午5点" / a bare "18:15" -> "HH:MM", else null. */
export function parseAbsoluteTime(text: string): string | null {
  const t = normalizeDigits(text)
  const clock = (hour: string, minute?: string, ap?: string): string | null => {
    let h = Number(hour)
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    if (h >= 24 || Number.isNaN(h)) return null
    return `${String(h).padStart(2, '0')}:${String(Number(minute ?? 0)).padStart(2, '0')}`
  }
  // (?:^|\s) instead of \b: word boundaries don't exist next to "à". The
  // lookaheads keep "at 3 Nov" and "at 3/11" from reading as three o'clock.
  let m = t.match(
    new RegExp(
      `(?:^|\\s)(?:at|à|um|a las|a la)\\s+(\\d{1,2})(?:[:h]([0-5]\\d))?\\s*(am|pm)?\\b(?![/.]\\d)(?!\\s*(?:of\\s+|de\\s+)?(?:${MONTH_ALT})${WE})`,
      'iu',
    ),
  )
  if (m) return clock(m[1], m[2], m[3]?.toLowerCase())
  m = t.match(/(?:ساعت|الساعة|الساعه)\s*(\d{1,2})(?::([0-5]\d))?/)
  if (m) return clock(m[1], m[2])
  m = t.match(/(上午|下午|晚上)?\s*(\d{1,2})\s*[点點](?:([0-5]\d)分?)?/)
  if (m) return clock(m[2], m[3], m[1] === '下午' || m[1] === '晚上' ? 'pm' : m[1] === '上午' ? 'am' : undefined)
  // no "at": "5pm" and "18:15" still name a time ("3 Nov, 18:15: fingerprints").
  // Only ":" and "h" separate hours from minutes - "19.30" is a price.
  m = t.match(/(?<![\d:.,])(\d{1,2})(?::([0-5]\d))?\s?(am|pm)\b/i)
  if (m) return clock(m[1], m[2], m[3].toLowerCase())
  m = t.match(/(?<![\d:.,])([01]?\d|2[0-3])[:h]([0-5]\d)(?!\d|:\d)/)
  if (m) return clock(m[1], m[2])
  return null
}

// "tmrw" and friends: the lite models save these with no date at all
const TOMORROW = /\b(tom+or+ow|tmrw|tmr|tmw|tomoz|2moro|2morrow|demain|morgen)\b/i
// "esta mañana" / "por la mañana" is the morning, not tomorrow
const TOMORROW_ES = /(?<!(?:esta|la)\s+)mañana/i
const TOMORROW_BARE = ['فردا', 'غدا', 'غدًا', 'غداً', '明天', '明早', '明晚']
const TODAY =
  /\b(today|tonight|this (?:morning|afternoon|evening)|aujourd'hui|aujourd’hui|ce soir|hoy|esta (?:noche|tarde|mañana)|heute|heute abend)\b/i
const TODAY_BARE = ['امروز', 'امشب', 'اليوم', 'الليلة', '今天', '今晚']

/** "tomorrow" / "today" / "tonight" (any pack language) anywhere in the text, else null. */
export function parseRelativeDay(text: string): 'tomorrow' | 'today' | null {
  if (TOMORROW.test(text) || TOMORROW_ES.test(text) || TOMORROW_BARE.some((w) => text.includes(w))) return 'tomorrow'
  if (TODAY.test(text) || TODAY_BARE.some((w) => text.includes(w))) return 'today'
  return null
}

const shiftDate = (date: string, n: number): string => {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** yyyy-mm-dd for a real calendar day, else null (31 Feb, month 13). */
function ymd(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  return d.getUTCMonth() === month - 1 ? d.toISOString().slice(0, 10) : null
}

/** A day and month with no year means the next time that date comes round. */
function nextOccurrence(month: number, day: number, today: string, year?: number): string | null {
  if (year) return ymd(year, month, day)
  const thisYear = Number(today.slice(0, 4))
  const date = ymd(thisYear, month, day)
  return date && date < today ? ymd(thisYear + 1, month, day) : date
}

/** The day a reminder is due, read from the words of the message: "tmrw",
 *  "on monday", "next week", "in 3 days", "3 Nov", "Nov 3rd", "the 15th",
 *  "by 25/11", "2026-11-25". Resolved against `today` (yyyy-mm-dd); null when
 *  the text names no day. When it names several, the first one wins - except
 *  a weekday written right before a date ("Tuesday 10 Nov"), where the date
 *  is the one that counts. */
export function parseDueDate(text: string, today: string): string | null {
  const t = normalizeDigits(text)
  const found: { at: number; end: number; date: string; weekday?: boolean }[] = []
  const scan = (source: string, resolve: (m: RegExpExecArray) => string | null, weekday = false) => {
    for (const m of t.matchAll(new RegExp(source, 'giu'))) {
      const date = resolve(m as RegExpExecArray)
      if (date) found.push({ at: m.index ?? 0, end: (m.index ?? 0) + m[0].length, date, weekday })
    }
  }
  const monthOf = (name: string) => MONTHS.findIndex((alt) => alt.split('|').includes(name.toLowerCase())) + 1

  // "3 Nov", "3rd of November 2027", "3 de noviembre", "3. November"
  scan(`${WB}(\\d{1,2})(?:st|nd|rd|th|\\.|º)?\\s+(?:of\\s+|de\\s+)?(${MONTH_ALT})${WE}(?:,?\\s+(\\d{4})${WE})?`, (m) =>
    nextOccurrence(monthOf(m[2]), Number(m[1]), today, m[3] ? Number(m[3]) : undefined),
  )
  // "Nov 3", "November 3rd, 2027"
  scan(`${WB}(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?${WE}(?![:h]\\d)(?:,?\\s+(\\d{4})${WE})?`, (m) =>
    nextOccurrence(monthOf(m[1]), Number(m[2]), today, m[3] ? Number(m[3]) : undefined),
  )
  // "2026-11-25"
  scan(`${WB}(\\d{4})-(\\d{2})-(\\d{2})${WE}`, (m) => ymd(Number(m[1]), Number(m[2]), Number(m[3])))
  // "25/11/2026", and "by 25/11" - day first, unless only month-first can be
  // a date. Without a year it needs the word in front: a bare "1/2" is half
  // a kilo, not the first of February.
  const numeric = (a: number, b: number, year?: number) => (a <= 12 && b > 12 ? nextOccurrence(a, b, today, year) : nextOccurrence(b, a, today, year))
  scan(`${WB}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4})${WE}`, (m) => numeric(Number(m[1]), Number(m[2]), Number(m[3])))
  scan(`${WB}(?:by|on|before|until|till|due|el|del|al|le|au)\\s+(\\d{1,2})/(\\d{1,2})${WE}(?![/.]\\d)`, (m) =>
    numeric(Number(m[1]), Number(m[2])),
  )
  // "the 15th": this month, or next month once that day has gone by
  scan(`${WB}the\\s+(\\d{1,2})(?:st|nd|rd|th)${WE}(?!\\s+(?:of\\s+)?(?:${MONTH_ALT})${WE})`, (m) => {
    const [year, month] = today.split('-').map(Number)
    const date = ymd(year, month, Number(m[1]))
    if (date && date >= today) return date
    return month === 12 ? ymd(year + 1, 1, Number(m[1])) : ymd(year, month + 1, Number(m[1]))
  })
  // "in 3 days", "in 2 weeks", "en 3 días", "dans 3 jours", "in 3 Tagen"
  scan(`${WB}(?:in|en|dans)\\s+(\\d{1,3})\\s+(days?|días?|dias?|jours?|tage?n?|weeks?|semanas?|semaines?|wochen?)${WE}`, (m) =>
    shiftDate(today, Number(m[1]) * (/^(w|sem)/i.test(m[2]) ? 7 : 1)),
  )
  scan(`${WB}(?:day after tomorrow|pasado mañana|après-demain|apres-demain|übermorgen)${WE}`, () => shiftDate(today, 2))
  scan(`${WB}(?:next week|la semana que viene|la próxima semana|la semaine prochaine|nächste woche)${WE}`, () => shiftDate(today, 7))
  // weekday names: the next such day after today
  const todayIso = new Date(today + 'T00:00:00Z').getUTCDay() || 7
  const ahead = (iso: number) => shiftDate(today, ((iso - todayIso + 6) % 7) + 1)
  WEEKDAYS.forEach((alt, i) => scan(`${WB}(?:${alt})${WE}`, () => ahead(i + 1), true))
  WEEKDAYS_SHORT.forEach((short, i) =>
    scan(`${WB}(?:on|by|next|this|until|till|before)\\s+${short}${WE}`, () => ahead(i + 1), true),
  )
  // tomorrow / today words, in every language parseRelativeDay knows
  scan(TOMORROW.source, () => shiftDate(today, 1))
  scan(TOMORROW_ES.source, () => shiftDate(today, 1))
  scan(TODAY.source, () => today)
  const bare = (words: string[], date: string) => {
    for (const w of words) {
      const at = t.indexOf(w)
      if (at >= 0) found.push({ at, end: at + w.length, date })
    }
  }
  bare(TOMORROW_BARE, shiftDate(today, 1))
  bare(TODAY_BARE, today)

  // earliest first; of two that start together the longer one, and anything
  // inside a longer phrase is dropped ("mañana" within "pasado mañana")
  found.sort((a, b) => a.at - b.at || b.end - a.end)
  const outer = found.filter((f, i) => !found.slice(0, i).some((g) => g.end >= f.end))
  const first = outer[0]
  if (!first) return null
  if (first.weekday) {
    const dated = outer.find((f) => !f.weekday && f.at - first.end <= 6)
    if (dated) return dated.date
  }
  return first.date
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
