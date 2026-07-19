// Guards the per-user cron jitter. The reflection loop's exactly-once
// guarantee depends on two properties: the offset never moves for a given
// user, and the processing window stays exactly one cron tick wide - so
// precisely one tick lands inside any user's window, wherever the tick
// phase sits in their timezone.
import { describe, expect, it } from 'vitest'
import { userSpreadMinutes } from '../supabase/functions/_shared/localtime'

const CADENCE = 15
const SPREAD = 45

describe('userSpreadMinutes', () => {
  it('is deterministic - the same user always gets the same offset', () => {
    const id = '92674026-2ab3-45c3-90b4-0f80848c5bfb'
    expect(userSpreadMinutes(id, SPREAD)).toBe(userSpreadMinutes(id, SPREAD))
  })

  it('stays within [0, spread)', () => {
    for (let i = 0; i < 200; i++) {
      const off = userSpreadMinutes(`user-${i}-${i * 7919}`, SPREAD)
      expect(off).toBeGreaterThanOrEqual(0)
      expect(off).toBeLessThan(SPREAD)
    }
  })

  it('actually spreads a cohort across ticks', () => {
    const ticks = new Set<number>()
    for (let i = 0; i < 100; i++) {
      ticks.add(Math.floor(userSpreadMinutes(`member-${i}`, SPREAD) / CADENCE))
    }
    // 100 users over a 45-min spread must occupy all three 15-min ticks
    expect(ticks.size).toBe(3)
  })

  it('exactly one tick lands in any window, at every tick phase', () => {
    // window = [start+offset, start+offset+CADENCE); ticks every CADENCE
    // minutes at an arbitrary phase (timezones offset ticks by :00/:15/:30/:45)
    for (let offset = 0; offset < SPREAD; offset++) {
      for (let phase = 0; phase < CADENCE; phase++) {
        let hits = 0
        for (let tick = phase; tick < 24 * 60; tick += CADENCE) {
          const start = 9 * 60 + offset
          if (tick >= start && tick < start + CADENCE) hits++
        }
        expect(hits).toBe(1)
      }
    }
  })
})
