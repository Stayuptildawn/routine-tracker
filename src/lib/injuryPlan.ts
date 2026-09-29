// Pure planning for injury reports: given a body part + severity and the
// upcoming (unlogged) planned sets, decide what each set becomes - left
// alone, a cue, one set lighter, swapped to a joint-friendlier movement, or
// dropped. No database here (lib/injuries.ts applies and restores), so the
// rules are unit-testable.
//
// The rules are deliberately conservative and name-based: an exercise is
// judged by what its name says it does to the joint ("press", "squat",
// "curl"), with the muscle group as a floor. Not medical advice - the UI
// says so, and pain that is sharp or getting worse goes to a professional.

import type { WorkoutPlan } from './types'

export const BODY_PARTS = ['neck', 'shoulder', 'elbow', 'wrist', 'lower_back', 'hip', 'knee', 'ankle'] as const
export type BodyPart = (typeof BODY_PARTS)[number]
export const SEVERITIES = ['mild', 'moderate', 'severe'] as const
export type Severity = (typeof SEVERITIES)[number]
export type Risk = 'high' | 'some' | null

// "leg press" / "leg extension" are lower-body - never let them trip the
// upper-body "press" / "extension" patterns
const P = '(?<!leg |calf )'
const RULES: Record<BodyPart, { high: RegExp; some: RegExp; muscles: string[] }> = {
  neck: {
    high: /shrug|upright row|overhead press|\bohp\b|military|shoulder press|behind.?the.?neck|neck/,
    some: /deadlift|squat|rack pull|farmer/,
    muscles: [],
  },
  shoulder: {
    high: new RegExp(
      `overhead|\\bohp\\b|military|shoulder press|arnold|\\bdips?\\b|upright row|bench press|incline|decline|${P}chest press|push press|\\bfly|flye|pec deck|crossover|lateral raise|snatch|behind.?the.?neck`,
    ),
    some: new RegExp(`${P}press|push.?up|pull.?up|chin.?up|pulldown|\\brow|face pull|skull|pullover`),
    muscles: ['Chest', 'Shoulders'],
  },
  elbow: {
    high: /skull|lying (tri|triceps? )?extension|overhead (cable |triceps? |db |dumbbell )?extension|french press|close.?grip|\bdips?\b|preacher|chin.?up/,
    some: new RegExp(`curl|pushdown|${P}extension|${P}press|pulldown|pull.?up|\\brow`),
    muscles: ['Biceps', 'Triceps'],
  },
  wrist: {
    high: /barbell curl|front squat|push.?up|\bdips?\b|\bclean|snatch|wrist/,
    some: new RegExp(`curl|${P}press|\\brow|deadlift|pull.?up|pulldown|farmer|shrug|plank`),
    muscles: [],
  },
  lower_back: {
    high: /deadlift|romanian|\brdl\b|good.?morning|bent.?over|barbell row|back squat|barbell squat|t.?bar|hyperextension|back extension|pendlay|\bclean|snatch/,
    some: /squat|leg press|lunge|split squat|hip thrust|pull.?through|overhead press|\bohp\b|military|swing|step.?up/,
    muscles: [],
  },
  hip: {
    high: /squat|lunge|deadlift|romanian|\brdl\b|hip thrust|pull.?through|good.?morning|step.?up|adduct|abduct|leg press|hack/,
    some: /leg curl|glute|bridge|kickback/,
    muscles: ['Glutes'],
  },
  knee: {
    high: /squat|lunge|leg extension|leg press|hack|step.?up|jump|pistol|sissy|bulgarian/,
    some: /leg curl|deadlift|romanian|\brdl\b|hip thrust/,
    muscles: ['Quads'],
  },
  ankle: {
    high: /jump|standing calf|calf raise|lunge|split squat|bulgarian|step.?up|box|skip/,
    some: /squat|seated calf|leg press|hack|deadlift/,
    muscles: ['Calves'],
  },
}

/** How much an exercise loads the injured part: 'high', 'some' or null. */
export function exerciseRisk(exercise: string, muscle: string | null | undefined, part: BodyPart): Risk {
  const name = exercise.toLowerCase()
  const rule = RULES[part]
  if (rule.high.test(name)) return 'high'
  if (rule.some.test(name)) return 'some'
  if (muscle && rule.muscles.includes(muscle)) return 'some'
  return null
}

// fallback swaps when the user's own plan has nothing safe for that muscle;
// each candidate is still run through exerciseRisk, so a knee injury simply
// finds no safe quad movement and the sets drop instead
const FALLBACKS: Record<string, string[]> = {
  Chest: ['Machine Chest Press', 'Cable Crossover', 'Push-Up'],
  Shoulders: ['Cable Lateral Raise', 'Face Pull', 'Reverse Fly Machine'],
  Triceps: ['Cable Tricep Pushdown', 'Overhead Cable Extension'],
  Back: ['Chest-Supported DB Row', 'Seated Cable Row', 'Lat Pulldown'],
  Biceps: ['DB Hammer Curl', 'Cable Curl'],
  Quads: ['Leg Extension', 'Leg Press'],
  Hamstrings: ['Lying Leg Curl', 'Seated Leg Curl'],
  Glutes: ['Glute Bridge', 'Cable Kickback'],
  Calves: ['Seated Calf Raise'],
}

// cardio that pounds the joint; the session's cardio note gets a low-impact
// swap for the lower-body injuries
const IMPACT_CARDIO = /run|jog|sprint|jump|hiit|stairs|skipping/i
const CARDIO_PARTS: BodyPart[] = ['hip', 'knee', 'ankle', 'lower_back']

export type Treatment = 'cue' | 'lighter' | 'swap' | 'drop'

/** What happens to an exercise at this risk and severity. 'swap' falls back
 *  to 'drop' when nothing safe exists for the muscle. */
export function treatment(risk: Risk, severity: Severity): Treatment | null {
  if (!risk) return null
  if (risk === 'high') return severity === 'mild' ? 'lighter' : 'swap'
  return severity === 'mild' ? 'cue' : severity === 'moderate' ? 'lighter' : 'swap'
}

export interface UpcomingSet {
  id: string
  session_id: string
  sort_order: number
  exercise: string
  muscle_group: string | null
  set_number: number
  target_scheme: string | null
  injury_note: string | null
  [col: string]: unknown // the rest of the row, kept for restoring drops
}

export interface UpcomingSession {
  id: string
  cardio: string | null
}

type SetFields = { exercise: string; target_scheme: string | null; injury_note: string | null }

/** One recorded edit - enough to put the row back exactly as it was. */
export type InjuryChange =
  | { kind: 'set'; id: string; before: SetFields; after: SetFields }
  | { kind: 'drop'; row: UpcomingSet }
  | { kind: 'cardio'; session_id: string; before: string | null; after: string }

/** Human-readable grouping for the preview: "Squat -> Leg Curl, 5 sessions". */
export interface PreviewLine {
  treatment: Treatment | 'cardio'
  exercise: string
  replacement?: string
  sessions: number
}

export interface InjuryNotes {
  cue: string
  lighter: string
  swapped: (from: string) => string
  lowImpactCardio: string
}

export interface PlanOpts {
  part: BodyPart
  severity: Severity
  sets: UpcomingSet[]
  sessions: UpcomingSession[]
  plans: WorkoutPlan[]
  /** other active injuries - a swap never lands on something they flag high */
  others?: BodyPart[]
  /** ids this injury already handled (sets and sessions) - re-planning skips them */
  handled?: Set<string>
  notes: InjuryNotes
}

const setsIn = (scheme: string | null, n: number) =>
  scheme && /^\s*\d+/.test(scheme) ? scheme.replace(/^\s*\d+/, String(n)) : scheme

/** Plan every change this injury makes to the upcoming sessions. */
export function planInjury(opts: PlanOpts): { changes: InjuryChange[]; preview: PreviewLine[] } {
  const { part, severity, sets, sessions, plans, notes } = opts
  const others = opts.others ?? []
  const handled = opts.handled ?? new Set<string>()
  const changes: InjuryChange[] = []
  const preview = new Map<string, PreviewLine & { ids: Set<string> }>()
  const note = (line: Omit<PreviewLine, 'sessions'>, sessionId: string) => {
    const key = `${line.treatment}|${line.exercise}|${line.replacement ?? ''}`
    const entry = preview.get(key) ?? { ...line, sessions: 0, ids: new Set<string>() }
    entry.ids.add(sessionId)
    entry.sessions = entry.ids.size
    preview.set(key, entry)
  }

  const safe = (exercise: string, muscle: string | null) =>
    exerciseRisk(exercise, muscle, part) === null && others.every((o) => exerciseRisk(exercise, muscle, o) !== 'high')
  // plan order first (the user's own movements), then the fallbacks
  const replacementFor = (muscle: string | null, taken: Set<string>): string | null => {
    if (!muscle) return null
    const own = [...new Set(plans.filter((p) => p.muscle_group === muscle).map((p) => p.exercise))]
    const pool = [...own, ...(FALLBACKS[muscle] ?? [])].filter((e) => safe(e, muscle))
    return pool.find((e) => !taken.has(e.toLowerCase())) ?? pool[0] ?? null
  }

  // one decision per exercise per session, applied to all its sets
  const bySession = new Map<string, UpcomingSet[]>()
  for (const s of sets) {
    if (handled.has(s.id)) continue
    bySession.set(s.session_id, [...(bySession.get(s.session_id) ?? []), s])
  }
  for (const [sessionId, rows] of bySession) {
    const taken = new Set(rows.map((r) => r.exercise.toLowerCase()))
    const byExercise = new Map<string, UpcomingSet[]>()
    for (const r of rows) byExercise.set(r.exercise, [...(byExercise.get(r.exercise) ?? []), r])
    for (const [exercise, exRows] of byExercise) {
      const muscle = exRows[0].muscle_group
      let what = treatment(exerciseRisk(exercise, muscle, part), severity)
      if (!what) continue
      const replacement = what === 'swap' ? replacementFor(muscle, taken) : null
      if (what === 'swap' && !replacement) what = 'drop'
      // explicit nulls: a missing key would vanish from the stored JSON and
      // the restore would leave that field as the injury set it
      const fields = (r: UpcomingSet): SetFields => ({
        exercise: r.exercise,
        target_scheme: r.target_scheme ?? null,
        injury_note: r.injury_note ?? null,
      })

      if (what === 'drop') {
        for (const r of exRows) changes.push({ kind: 'drop', row: r })
        note({ treatment: 'drop', exercise }, sessionId)
      } else if (what === 'swap') {
        taken.add(replacement!.toLowerCase())
        for (const r of exRows)
          changes.push({ kind: 'set', id: r.id, before: fields(r), after: { exercise: replacement!, target_scheme: r.target_scheme, injury_note: notes.swapped(exercise) } })
        note({ treatment: 'swap', exercise, replacement: replacement! }, sessionId)
      } else if (what === 'lighter') {
        // one set fewer (never below two), the rest carry the cue
        const ordered = [...exRows].sort((a, b) => a.set_number - b.set_number)
        const keep = ordered.length > 2 ? ordered.slice(0, -1) : ordered
        for (const r of ordered.slice(keep.length)) changes.push({ kind: 'drop', row: r })
        for (const r of keep)
          changes.push({
            kind: 'set',
            id: r.id,
            before: fields(r),
            after: { exercise: r.exercise, target_scheme: keep.length < ordered.length ? setsIn(r.target_scheme, keep.length) : r.target_scheme, injury_note: notes.lighter },
          })
        note({ treatment: 'lighter', exercise }, sessionId)
      } else {
        for (const r of exRows) changes.push({ kind: 'set', id: r.id, before: fields(r), after: { ...fields(r), injury_note: notes.cue } })
        note({ treatment: 'cue', exercise }, sessionId)
      }
    }
  }

  if (severity !== 'mild' && CARDIO_PARTS.includes(part) && (part !== 'lower_back' || severity === 'severe')) {
    for (const s of sessions) {
      if (handled.has(s.id) || !s.cardio || !IMPACT_CARDIO.test(s.cardio)) continue
      changes.push({ kind: 'cardio', session_id: s.id, before: s.cardio, after: notes.lowImpactCardio })
      note({ treatment: 'cardio', exercise: s.cardio }, s.id)
    }
  }

  const order: Record<PreviewLine['treatment'], number> = { drop: 0, swap: 1, lighter: 2, cue: 3, cardio: 4 }
  return {
    changes,
    preview: [...preview.values()]
      .map(({ ids: _ids, ...line }) => line)
      .sort((a, b) => order[a.treatment] - order[b.treatment] || a.exercise.localeCompare(b.exercise)),
  }
}

/** Every set/session id a list of changes touched - the `handled` set. */
export function handledIds(changes: InjuryChange[]): Set<string> {
  const ids = new Set<string>()
  for (const c of changes) ids.add(c.kind === 'set' ? c.id : c.kind === 'drop' ? c.row.id : c.session_id)
  return ids
}
