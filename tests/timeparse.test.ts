// Unit tests for the deterministic time/date parsing that backs the AI
// composer. Every case here started life as a real bug found in production
// on 2026-07-11 - if you touch timeparse.ts, run `npm test` first.
import { describe, expect, it } from 'vitest'
import {
  addMinutesToClock,
  clampDaysAgo,
  mentionsYesterday,
  normalizeAvgHr,
  normalizeDigits,
  normalizeDueInMinutes,
  normalizeDueTime,
  parseAbsoluteTime,
  parseBpm,
  parseDueDate,
  parseRelativeDay,
  parseRelativeMinutes,
} from '../supabase/functions/_shared/timeparse'

describe('multilingual fallbacks', () => {
  it('normalizes Persian and Arabic-Indic digits', () => {
    expect(normalizeDigits('۵ کیلومتر در ۳۲ دقیقه')).toBe('5 کیلومتر در 32 دقیقه')
    expect(normalizeDigits('٥ كم')).toBe('5 كم')
    expect(normalizeDigits('plain 5 km')).toBe('plain 5 km')
  })
  it('parses relative minutes across languages', () => {
    expect(parseRelativeMinutes('rappelle-moi dans 10 min')).toBe(10)
    expect(parseRelativeMinutes('recuérdame en 2 horas')).toBe(120)
    expect(parseRelativeMinutes('erinnere mich in 45 minuten')).toBe(45)
    expect(parseRelativeMinutes('بعد 10 دقائق')).toBe(10)
    expect(parseRelativeMinutes('۱۰ دقیقه دیگر یادم بنداز')).toBe(10)
    expect(parseRelativeMinutes('10分钟后提醒我')).toBe(10)
  })
  it('parses absolute times across languages', () => {
    expect(parseAbsoluteTime('rappelle-moi à 17h30')).toBe('17:30')
    expect(parseAbsoluteTime('erinnere mich um 17:30')).toBe('17:30')
    expect(parseAbsoluteTime('recuérdame a las 5pm')).toBe('17:00')
    expect(parseAbsoluteTime('ساعت ۱۸ یادم بنداز')).toBe('18:00')
    expect(parseAbsoluteTime('الساعة 18')).toBe('18:00')
    expect(parseAbsoluteTime('下午5点提醒我')).toBe('17:00')
  })
  it('recognizes tomorrow/today/yesterday words across languages', () => {
    expect(parseRelativeDay('demain matin')).toBe('tomorrow')
    expect(parseRelativeDay('فردا صبح')).toBe('tomorrow')
    expect(parseRelativeDay('明天早上')).toBe('tomorrow')
    expect(parseRelativeDay('اليوم')).toBe('today')
    expect(parseRelativeDay('heute abend')).toBe('today')
    expect(mentionsYesterday('گلدون‌ها رو دیروز آب دادم')).toBe(true)
    expect(mentionsYesterday('hice los platos ayer')).toBe(true)
    expect(mentionsYesterday('昨天洗了碗')).toBe(true)
    expect(mentionsYesterday('a year ago')).toBe(false)
  })
})

describe('normalizeDueTime', () => {
  it('accepts sloppy model output', () => {
    expect(normalizeDueTime('9:30')).toBe('09:30')
    expect(normalizeDueTime('17:30:00')).toBe('17:30')
    expect(normalizeDueTime('14:20')).toBe('14:20')
  })
  it('rejects junk', () => {
    expect(normalizeDueTime('25:00')).toBeNull()
    expect(normalizeDueTime('5pm')).toBeNull()
    expect(normalizeDueTime('')).toBeNull()
    expect(normalizeDueTime(undefined)).toBeNull()
  })
})

describe('parseRelativeMinutes', () => {
  it('reads minutes and hours', () => {
    expect(parseRelativeMinutes('remind me to drink water in 10 mins')).toBe(10)
    expect(parseRelativeMinutes('in 5 minutes please')).toBe(5)
    expect(parseRelativeMinutes('stretch in 2 hours')).toBe(120)
    expect(parseRelativeMinutes('in 1 h')).toBe(60)
  })
  it('ignores unrelated text', () => {
    expect(parseRelativeMinutes('I believe in you')).toBeNull()
    expect(parseRelativeMinutes('ran 5k in 25 min')).toBe(25) // known overlap: cardio times also match
  })
})

describe('parseAbsoluteTime', () => {
  it('reads 24h and am/pm', () => {
    expect(parseAbsoluteTime('call the bank at 17:30')).toBe('17:30')
    expect(parseAbsoluteTime('call the bank at 5pm')).toBe('17:00')
    expect(parseAbsoluteTime('at 5 pm')).toBe('17:00')
    expect(parseAbsoluteTime('at 12am')).toBe('00:00')
    expect(parseAbsoluteTime('at 12pm')).toBe('12:00')
    expect(parseAbsoluteTime('wake me at 7')).toBe('07:00')
  })
  it('rejects impossible hours', () => {
    expect(parseAbsoluteTime('at 25:00')).toBeNull()
    expect(parseAbsoluteTime('no time here')).toBeNull()
  })
})

describe('parseRelativeDay / mentionsYesterday', () => {
  it('finds day words', () => {
    expect(parseRelativeDay('call the bank tomorrow at 5pm')).toBe('tomorrow')
    expect(parseRelativeDay('do it tonight')).toBe('today')
    expect(parseRelativeDay('do it today')).toBe('today')
    expect(parseRelativeDay('no day named')).toBeNull()
    expect(mentionsYesterday('I did the dishes yesterday')).toBe(true)
    expect(mentionsYesterday('I did the dishes')).toBe(false)
  })
})

// Every message here was really sent on 2026-11-01 or 2026-11-11 and was
// saved with no date, or the wrong one.
describe('parseDueDate', () => {
  const SUN = '2026-11-01' // a Sunday
  const WED = '2026-11-11' // a Wednesday

  it('reads the short ways of writing tomorrow', () => {
    expect(parseDueDate('Remind me to go to uni tmrw', WED)).toBe('2026-11-12')
    expect(parseDueDate('call mum tommorow', WED)).toBe('2026-11-12')
    expect(parseDueDate('do it today', WED)).toBe(WED)
    expect(parseDueDate('buy bananas', WED)).toBeNull()
  })
  it('resolves a weekday name to the next such day', () => {
    expect(parseDueDate('Pay the TASA on monday', SUN)).toBe('2026-11-02')
    expect(parseDueDate('call the bank by Friday', WED)).toBe('2026-11-13')
    expect(parseDueDate('gym on wed', WED)).toBe('2026-11-18') // said on a Wednesday: next week's
    expect(parseDueDate('llamar al banco el viernes', WED)).toBe('2026-11-13')
  })
  it('does not read ordinary words as days', () => {
    expect(parseDueDate('buy sun cream', WED)).toBeNull()
    expect(parseDueDate('I sat on the mon cheri box', WED)).toBeNull()
    expect(parseDueDate('buy 1/2 kg of rice', WED)).toBeNull()
    expect(parseDueDate('Pay the €19.30 fee', WED)).toBeNull()
  })
  it('reads calendar dates, rolling a past one into next year', () => {
    expect(parseDueDate('3 Nov, 18:15: the fingerprint appointment at Alcobendas.', SUN)).toBe('2026-11-03')
    expect(parseDueDate('Remind me at 3 Nov, 18:15: the fingerprint appointment', SUN)).toBe('2026-11-03')
    expect(parseDueDate('dentist on November 20th', SUN)).toBe('2026-11-20')
    expect(parseDueDate('el 3 de diciembre', SUN)).toBe('2026-12-03')
    expect(parseDueDate('renew passport 15 Jan', SUN)).toBe('2027-01-15')
    expect(parseDueDate('file it by 25/11', SUN)).toBe('2026-11-25')
    expect(parseDueDate('due 2026-12-24', SUN)).toBe('2026-12-24')
    expect(parseDueDate('pay rent on the 15th', WED)).toBe('2026-11-15')
    expect(parseDueDate('pay rent on the 5th', WED)).toBe('2026-12-05')
    expect(parseDueDate('party on 31 Feb', SUN)).toBeNull()
  })
  it('lets the date beat the weekday written in front of it', () => {
    expect(parseDueDate('- Tuesday 10 Nov: the same for Brito.', SUN)).toBe('2026-11-10')
    expect(parseDueDate('- Monday 9 Nov: follow up with Asunción', SUN)).toBe('2026-11-09')
  })
  it('takes the first day named', () => {
    expect(parseDueDate('- Tomorrow (2 Nov): pay the fee', SUN)).toBe('2026-11-02')
    expect(parseDueDate('on friday book the flights for 5 Dec', WED)).toBe('2026-11-13')
    expect(parseDueDate('By 20 Nov: the letter should arrive, file it by 25/11', SUN)).toBe('2026-11-20')
  })
  it('reads day counts and other languages', () => {
    expect(parseDueDate('check the oven in 3 days', WED)).toBe('2026-11-14')
    expect(parseDueDate('review in 2 weeks', WED)).toBe('2026-11-25')
    expect(parseDueDate('next week call the landlord', WED)).toBe('2026-11-18')
    expect(parseDueDate('pasado mañana ir al banco', WED)).toBe('2026-11-13')
    expect(parseDueDate('comprar pan mañana', WED)).toBe('2026-11-12')
    expect(parseDueDate('comprar pan esta mañana', WED)).toBe(WED)
    expect(parseDueDate('فردا صبح', WED)).toBe('2026-11-12')
  })
})

describe('parseAbsoluteTime without "at"', () => {
  it('reads a bare clock time', () => {
    expect(parseAbsoluteTime('3 Nov, 18:15: the fingerprint appointment')).toBe('18:15')
    expect(parseAbsoluteTime('dentist tomorrow 5pm')).toBe('17:00')
    expect(parseAbsoluteTime('dentist tomorrow 9:30 am')).toBe('09:30')
  })
  it('does not take a day of the month or a price for the hour', () => {
    expect(parseAbsoluteTime('Remind me at 3 Nov, 18:15: the fingerprint appointment')).toBe('18:15')
    expect(parseAbsoluteTime('remind me at 3 Nov')).toBeNull()
    expect(parseAbsoluteTime('pay the €19.30 fee')).toBeNull()
  })
})

describe('addMinutesToClock', () => {
  it('adds within the day', () => {
    expect(addMinutesToClock('15:24', 10)).toEqual({ time: '15:34', dayOffset: 0 })
  })
  it('rolls past midnight', () => {
    expect(addMinutesToClock('23:55', 10)).toEqual({ time: '00:05', dayOffset: 1 })
    expect(addMinutesToClock('23:00', 180)).toEqual({ time: '02:00', dayOffset: 1 })
  })
})

describe('clampDaysAgo', () => {
  it('clamps to 0..7 and tolerates junk', () => {
    expect(clampDaysAgo(1)).toBe(1)
    expect(clampDaysAgo('2')).toBe(2)
    expect(clampDaysAgo(99)).toBe(7)
    expect(clampDaysAgo(-3)).toBe(0)
    expect(clampDaysAgo('yesterday')).toBe(0)
    expect(clampDaysAgo(undefined)).toBe(0)
  })
})

describe('normalizeDueInMinutes', () => {
  it('coerces strings, rejects non-positive', () => {
    expect(normalizeDueInMinutes(10)).toBe(10)
    expect(normalizeDueInMinutes('10')).toBe(10) // the lite models emit numbers as strings
    expect(normalizeDueInMinutes(0)).toBeNull()
    expect(normalizeDueInMinutes(-5)).toBeNull()
    expect(normalizeDueInMinutes('soon')).toBeNull()
  })
})

describe('bpm', () => {
  it('parses from text and bounds it', () => {
    expect(parseBpm('ran 5k in 25 min at 152 bpm')).toBe(152)
    expect(parseBpm('no heart rate here')).toBeNull()
    expect(normalizeAvgHr(139)).toBe(139)
    expect(normalizeAvgHr('152')).toBe(152)
    expect(normalizeAvgHr(999)).toBeNull()
    expect(normalizeAvgHr(10)).toBeNull()
  })
})
