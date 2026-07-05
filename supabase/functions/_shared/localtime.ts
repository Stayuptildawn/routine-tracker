// The user's local calendar, server-side. Cron fires in UTC; the user lives
// in USER_TIMEZONE (IANA name, e.g. Europe/Madrid). Invalid names fall back
// to UTC rather than throwing - a wrong-by-hours date beats a dead function.

export function userTimezone(preferred?: string | null): string {
  const tz = preferred || Deno.env.get('USER_TIMEZONE') || 'UTC'
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz })
    return tz
  } catch {
    console.error(`invalid timezone "${tz}" - falling back to UTC`)
    return 'UTC'
  }
}

/** Now in the user's timezone: yyyy-mm-dd, ISO weekday (1=Mon), minutes since midnight. */
export function userNow(preferred?: string | null): { date: string; weekday: number; minutes: number } {
  const tz = userTimezone(preferred)
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false })
    .format(now)
    .split(':')
    .map(Number)
  return { date, weekday, minutes: h * 60 + m }
}

/** date ± n days, in yyyy-mm-dd (pure date math, timezone-free). */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
