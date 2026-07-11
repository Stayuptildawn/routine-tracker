// Deterministic time/date parsing for the interpret core. Everything here is
// a pure function with no Deno APIs, so the same file is unit-tested from
// vitest (tests/timeparse.test.ts) and imported by the edge functions.
//
// The design rule these encode: anything time-shaped is never left to the
// model's arithmetic. The model points at tasks and reminders; clocks and
// calendars are resolved here.

/** Model-emitted time in any sloppy shape ("9:30", "17:30:00") -> "HH:MM", else null. */
export function normalizeDueTime(raw: unknown): string | null {
  const m = String(raw ?? '').match(/^(\d{1,2}):([0-5]\d)(?::\d{2})?$/)
  if (!m || Number(m[1]) >= 24) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

/** "in 10 mins" / "in 2 hours" anywhere in the text -> minutes from now, else null. */
export function parseRelativeMinutes(text: string): number | null {
  const m = text.match(/\bin\s+(\d+)\s*(min|mins|minute|minutes|h|hr|hrs|hour|hours)\b/i)
  if (!m) return null
  return Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1)
}

/** "at 5pm" / "at 17:30" / "at 12am" anywhere in the text -> "HH:MM", else null. */
export function parseAbsoluteTime(text: string): string | null {
  const m = text.match(/\bat\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\b/i)
  if (!m) return null
  let h = Number(m[1])
  const min = Number(m[2] ?? 0)
  const ap = m[3]?.toLowerCase()
  if (ap === 'pm' && h < 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  if (h >= 24) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/** "tomorrow" / "today" / "tonight" anywhere in the text, else null. */
export function parseRelativeDay(text: string): 'tomorrow' | 'today' | null {
  if (/\btomorrow\b/i.test(text)) return 'tomorrow'
  if (/\b(today|tonight)\b/i.test(text)) return 'today'
  return null
}

/** True when the text plainly reports a past day ("did X yesterday"). */
export function mentionsYesterday(text: string): boolean {
  return /\byesterday\b/i.test(text)
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
  const m = text.match(/(\d{2,3})\s*bpm\b/i)
  if (!m) return null
  const n = Number(m[1])
  return n > 30 && n < 250 ? n : null
}

/** Model-emitted avg_hr in any shape -> sanity-bounded integer, else null. */
export function normalizeAvgHr(raw: unknown): number | null {
  const n = Number(raw)
  return Number.isFinite(n) && n > 30 && n < 250 ? Math.round(n) : null
}
