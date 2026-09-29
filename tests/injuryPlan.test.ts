// The injury planner: which exercises load which joint, what each severity
// does to them, where swaps come from, and that re-planning is a no-op.
import { describe, expect, it } from 'vitest'
import { cardioKindOf, cardioVolumeCap, combinedCardio, exerciseRisk, handledIds, planInjury, safeCardioKinds, treatment } from '../src/lib/injuryPlan'
import type { UpcomingSet, UpcomingSession } from '../src/lib/injuryPlan'
import type { WorkoutPlan } from '../src/lib/types'

const notes = {
  cue: 'cue',
  lighter: 'lighter',
  swapped: (from: string) => `swapped for ${from}`,
  cardioSwap: (kinds: string[]) => (kinds.length ? `${kinds.join('/')} instead` : 'rest'),
}

let n = 0
function sets(session: string, exercise: string, muscle: string, count: number, scheme = `${count} x 8-10`): UpcomingSet[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${++n}`,
    session_id: session,
    sort_order: i + 1,
    exercise,
    muscle_group: muscle,
    set_number: i + 1,
    target_scheme: scheme,
    injury_note: null,
  }))
}

const plan = (exercise: string, muscle: string): WorkoutPlan => ({
  id: exercise,
  block: 1,
  split_day: 'X',
  sort_order: 0,
  exercise,
  type: null,
  safety_note: null,
  schemes: { '1-2': '3 x 10' },
  cardio: null,
  muscle_group: muscle,
})

describe('exerciseRisk', () => {
  it('reads the joint load from the exercise name', () => {
    expect(exerciseRisk('Seated DB OHP', 'Shoulders', 'shoulder')).toBe('high')
    expect(exerciseRisk('Hack Squat Machine', 'Quads', 'knee')).toBe('high')
    expect(exerciseRisk('Romanian Deadlift', 'Hamstrings', 'lower_back')).toBe('high')
    expect(exerciseRisk('Lying Leg Curl', 'Hamstrings', 'knee')).toBe('some')
  })

  it('never lets leg press / leg extension trip the upper-body patterns', () => {
    expect(exerciseRisk('Leg Press', 'Quads', 'shoulder')).toBeNull()
    expect(exerciseRisk('Leg Extension', 'Quads', 'elbow')).toBeNull()
    expect(exerciseRisk('Leg Press', 'Quads', 'knee')).toBe('high')
  })

  it('uses the muscle group as a floor', () => {
    expect(exerciseRisk('Mystery Machine', 'Chest', 'shoulder')).toBe('some')
    expect(exerciseRisk('Mystery Machine', 'Back', 'shoulder')).toBeNull()
  })
})

describe('treatment by severity', () => {
  it('escalates with severity', () => {
    expect(treatment('high', 'mild')).toBe('lighter')
    expect(treatment('high', 'moderate')).toBe('swap')
    expect(treatment('some', 'mild')).toBe('cue')
    expect(treatment('some', 'moderate')).toBe('lighter')
    expect(treatment('some', 'severe')).toBe('swap')
    expect(treatment(null, 'severe')).toBeNull()
  })
})

describe('planInjury', () => {
  it('drops a shoulder press when nothing shoulder-safe trains the muscle', () => {
    const upcoming = sets('a', 'Seated DB OHP', 'Shoulders', 3)
    const { changes, preview } = planInjury({
      part: 'shoulder',
      severity: 'moderate',
      sets: upcoming,
      sessions: [],
      // Face Pull still loads the shoulder, and so does every fallback
      plans: [plan('Seated DB OHP', 'Shoulders'), plan('Face Pull', 'Shoulders')],
      notes,
    })
    expect(changes.every((c) => c.kind === 'drop')).toBe(true)
    expect(preview).toEqual([{ treatment: 'drop', exercise: 'Seated DB OHP', sessions: 1 }])
  })

  it('swaps a knee-heavy lift for a safe same-muscle movement when one exists', () => {
    const upcoming = sets('a', 'Hip Thrust', 'Glutes', 3)
    const { changes } = planInjury({
      part: 'knee',
      severity: 'severe',
      sets: upcoming,
      sessions: [],
      plans: [plan('Hip Thrust', 'Glutes'), plan('Cable Kickback', 'Glutes')],
      notes,
    })
    expect(changes).toHaveLength(3)
    for (const c of changes) {
      expect(c.kind).toBe('set')
      if (c.kind === 'set') {
        expect(c.after.exercise).toBe('Cable Kickback')
        expect(c.after.injury_note).toBe('swapped for Hip Thrust')
        expect(c.before.exercise).toBe('Hip Thrust')
      }
    }
  })

  it('drops quad work entirely for a severe knee - nothing quad-based is safe', () => {
    const upcoming = [...sets('a', 'Leg Press', 'Quads', 3), ...sets('a', 'Leg Extension', 'Quads', 3)]
    const { changes } = planInjury({ part: 'knee', severity: 'severe', sets: upcoming, sessions: [], plans: [], notes })
    expect(changes.filter((c) => c.kind === 'drop')).toHaveLength(6)
  })

  it('lighter = one set fewer (never below two), retargeted, rest carry the cue', () => {
    const four = sets('a', 'Leg Press', 'Quads', 4, '4 x 8-10')
    const two = sets('b', 'Leg Press', 'Quads', 2, '2 x 8-10')
    const { changes } = planInjury({ part: 'knee', severity: 'mild', sets: [...four, ...two], sessions: [], plans: [], notes })
    const drops = changes.filter((c) => c.kind === 'drop')
    expect(drops).toHaveLength(1)
    expect(drops[0].kind === 'drop' && drops[0].row.set_number).toBe(4)
    const kept = changes.filter((c) => c.kind === 'set')
    expect(kept).toHaveLength(5)
    for (const c of kept) if (c.kind === 'set') expect(c.after.injury_note).toBe('lighter')
    const inA = kept.find((c) => c.kind === 'set' && c.id === four[0].id)
    expect(inA?.kind === 'set' && inA.after.target_scheme).toBe('3 x 8-10')
    const inB = kept.find((c) => c.kind === 'set' && c.id === two[0].id)
    expect(inB?.kind === 'set' && inB.after.target_scheme).toBe('2 x 8-10') // already at the floor
  })

  it('leaves unaffected exercises alone', () => {
    const upcoming = [...sets('a', 'Cable Tricep Pushdown', 'Triceps', 3), ...sets('a', 'Lying Leg Curl', 'Hamstrings', 3)]
    const { changes } = planInjury({ part: 'shoulder', severity: 'severe', sets: upcoming, sessions: [], plans: [], notes })
    expect(changes).toHaveLength(0)
  })

  it('swaps running for kinds that suit a moderate ankle, fully-fine ones first', () => {
    const sessions: UpcomingSession[] = [
      { id: 'a', cardio: 'Zone 2 Run (5km) Post-Workout' },
      { id: 'b', cardio: 'Bike 20 min' },
      { id: 'c', cardio: null },
    ]
    const { changes } = planInjury({ part: 'ankle', severity: 'moderate', sets: [], sessions, plans: [], notes })
    expect(changes).toEqual([{ kind: 'cardio', session_id: 'a', before: 'Zone 2 Run (5km) Post-Workout', after: 'swim/cycle/walk instead' }])
    // mild leaves cardio alone
    expect(planInjury({ part: 'ankle', severity: 'mild', sets: [], sessions, plans: [], notes }).changes).toHaveLength(0)
  })

  it('never swaps onto something another active injury flags high', () => {
    const upcoming = () => sets('a', 'Romanian Deadlift', 'Hamstrings', 2)
    const plans = [plan('Romanian Deadlift', 'Hamstrings'), plan('Good Morning', 'Hamstrings')]
    // knee alone: Good Morning is knee-safe, so it's the swap
    const alone = planInjury({ part: 'knee', severity: 'severe', sets: upcoming(), sessions: [], plans, notes })
    expect(alone.changes.every((c) => c.kind === 'set' && c.after.exercise === 'Good Morning')).toBe(true)
    // with a lower-back injury active, Good Morning is off the table; the leg
    // curl fallbacks load the knee, so the sets drop instead
    const both = planInjury({ part: 'knee', severity: 'severe', sets: upcoming(), sessions: [], plans, others: ['lower_back'], notes })
    expect(both.changes.every((c) => c.kind === 'drop')).toBe(true)
  })

  it('records explicit nulls so a restore can clear the cue again', () => {
    // rows written before the injury_note column existed come back without it
    const legacy = sets('a', 'Hip Thrust', 'Glutes', 3).map(({ injury_note: _n, ...r }) => r as UpcomingSet)
    const { changes } = planInjury({ part: 'knee', severity: 'mild', sets: legacy, sessions: [], plans: [], notes })
    const stored = JSON.parse(JSON.stringify(changes)) // what the jsonb column round-trips
    for (const c of stored) if (c.kind === 'set') expect(c.before).toHaveProperty('injury_note', null)
  })

  it('re-planning with its own handled ids is a no-op', () => {
    const upcoming = [...sets('a', 'Leg Press', 'Quads', 3), ...sets('a', 'Hip Thrust', 'Glutes', 3)]
    const first = planInjury({ part: 'knee', severity: 'moderate', sets: upcoming, sessions: [{ id: 'a', cardio: 'Run 5k' }], plans: [], notes })
    expect(first.changes.length).toBeGreaterThan(0)
    const again = planInjury({
      part: 'knee',
      severity: 'moderate',
      sets: upcoming,
      sessions: [{ id: 'a', cardio: 'Run 5k' }],
      plans: [],
      handled: handledIds(first.changes),
      notes,
    })
    expect(again.changes).toHaveLength(0)
  })
})

describe('cardio rules', () => {
  it('reads the kind from a free-text cardio note', () => {
    expect(cardioKindOf('Zone 2 Run (5km) Post-Workout')).toBe('run')
    expect(cardioKindOf('Easy swim 20 min')).toBe('swim')
    expect(cardioKindOf('Spin bike intervals')).toBe('cycle')
    expect(cardioKindOf('Stretching')).toBeNull()
  })

  it('a knee rules out running, a shoulder rules out swimming', () => {
    expect(combinedCardio([{ body_part: 'knee', severity: 'moderate' }])).toMatchObject({ run: 'avoid', swim: 'ok' })
    expect(combinedCardio([{ body_part: 'shoulder', severity: 'moderate' }])).toMatchObject({ run: 'ok', swim: 'avoid' })
  })

  it('takes the strictest status across injuries and offers what suits all of them', () => {
    const both = [
      { body_part: 'knee' as const, severity: 'moderate' as const },
      { body_part: 'shoulder' as const, severity: 'moderate' as const },
    ]
    expect(combinedCardio(both)).toEqual({ run: 'avoid', walk: 'easy', cycle: 'easy', swim: 'avoid' })
    expect(safeCardioKinds(both)).toEqual(['cycle', 'walk'])
  })

  it('never swaps a session’s run to swimming when a shoulder is also hurt', () => {
    const sessions: UpcomingSession[] = [{ id: 'a', cardio: 'Zone 2 Run (5km)' }]
    const { changes } = planInjury({
      part: 'knee',
      severity: 'moderate',
      sets: [],
      sessions,
      plans: [],
      otherInjuries: [{ body_part: 'shoulder', severity: 'moderate' }],
      notes,
    })
    expect(changes).toEqual([{ kind: 'cardio', session_id: 'a', before: 'Zone 2 Run (5km)', after: 'cycle/walk instead' }])
  })

  it('swaps a swim for a shoulder injury, and leaves runs alone', () => {
    const sessions: UpcomingSession[] = [
      { id: 'a', cardio: 'Easy swim 20 min' },
      { id: 'b', cardio: 'Zone 2 Run (5km)' },
    ]
    const { changes } = planInjury({ part: 'shoulder', severity: 'moderate', sets: [], sessions, plans: [], notes })
    expect(changes.map((c) => c.kind === 'cardio' && c.session_id)).toEqual(['a'])
  })

  it('caps weekly volume while injured - tighter for worse injuries, none for unrelated ones', () => {
    expect(cardioVolumeCap([])).toBeNull()
    expect(cardioVolumeCap([{ body_part: 'elbow', severity: 'mild' }])).toBeNull() // nothing flagged
    expect(cardioVolumeCap([{ body_part: 'knee', severity: 'mild' }])).toBe(1)
    expect(cardioVolumeCap([{ body_part: 'knee', severity: 'mild' }, { body_part: 'ankle', severity: 'severe' }])).toBe(0.5)
  })
})
