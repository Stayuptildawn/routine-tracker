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
