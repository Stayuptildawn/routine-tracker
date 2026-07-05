// A simple, science-backed cardio plan that runs parallel to the strength
// blocks. Principles:
//  - Aerobic base first: almost all volume is easy/Zone 2 (conversational
//    pace), the 80/20 polarized model. Easy work builds the engine.
//  - Progressive overload, but gently: ~10-15% more volume per week, which
//    keeps it under the "don't spike your mileage" injury threshold.
//  - Deload every 6th week: volume drops so the body absorbs the work.
//  - Consistency over heroics: 2 easy sessions on base/deload weeks, 3 on
//    build/peak weeks.
// The whole plan scales off one number: your easy-week baseline volume (km).

export const DEFAULT_BASE_KM = 10 // two easy 5k runs

interface CardioWeek {
  phase: string
  factor: number // multiplied by baseline for this week's target km
  sessions: number
}

// one 6-week cycle, repeats each block
const CYCLE: CardioWeek[] = [
  { phase: 'Base', factor: 1.0, sessions: 2 },
  { phase: 'Base', factor: 1.1, sessions: 2 },
  { phase: 'Build', factor: 1.25, sessions: 3 },
  { phase: 'Build', factor: 1.4, sessions: 3 },
  { phase: 'Peak', factor: 1.5, sessions: 3 },
  { phase: 'Deload', factor: 0.55, sessions: 2 },
]

export interface CardioTarget {
  week: number // 1-based within the cycle
  phase: string
  km: number
  sessions: number
  note: string
}

/** This week's cardio target from a baseline and a 1-based program week. */
export function cardioTargetForWeek(baseKm: number, programWeek: number): CardioTarget {
  const idx = ((Math.max(1, programWeek) - 1) % 6)
  const w = CYCLE[idx]
  const km = Math.round(baseKm * w.factor * 10) / 10
  const note =
    w.phase === 'Deload'
      ? 'Easy week. Keep it short and gentle so the last block settles in.'
      : w.phase === 'Peak'
        ? 'Highest volume of the cycle. Still all conversational pace — easy is the point.'
        : w.phase === 'Build'
          ? 'Adding a little distance. Keep every session easy enough to hold a conversation.'
          : 'Building the aerobic base. All easy, all Zone 2.'
  return { week: idx + 1, phase: w.phase, km, sessions: w.sessions, note }
}
