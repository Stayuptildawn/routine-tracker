// The demo's sample data: what a visitor finds the first time they open it.
// One believable person over two months - routines ticked on most days, a
// training block in its third week, runs, a few reminders, the AI's weekly
// notes - so every tab has something real on it. Dates are all counted back
// from today and nothing is random, so every visitor gets the same picture.
// Plain data, no database access: the fake client (demoClient.ts) stores it.

import { localDate, isoWeekday } from './types'
import { t } from '../i18n'
import { starterPlanRows } from './starterPlan'

export type Row = Record<string, unknown>
export type Db = Record<string, Row[]>

/** How far back the routine history goes. */
const HISTORY_DAYS = 56

function dayNDaysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d
}

function dateNDaysAgo(n: number): string {
  return localDate(dayNDaysAgo(n))
}

export function isoNDaysAgo(n: number, hour = 12, minute = 15): string {
  const d = dayNDaysAgo(n)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

// ---------- routines ----------

// when in the day each active routine tends to get ticked, by seed position:
// [first hour, hours it spreads over]
const ROUTINE_HOURS: [number, number][] = [
  [7, 2], // morning
  [12, 6], // through the day
  [18, 3], // home
  [21, 2], // bedtime
  [10, 4], // weekly reset
]
const MORNING = 0
const BEDTIME = 3

function seedRoutines(data: Db) {
  const routines: Row[] = []
  const tasks: Row[] = []
  const taskLogs: Row[] = []

  t.seed.forEach((r, i) => {
    const routineId = crypto.randomUUID()
    routines.push({
      id: routineId,
      name: r.name,
      category: r.category,
      sort_order: i,
      // two anchors, so Today shows how a routine floats up near its time
      anchor_time: i === MORNING ? '08:00:00' : i === BEDTIME ? '22:00:00' : null,
      active: r.active ?? true,
      created_at: isoNDaysAgo(HISTORY_DAYS + 4),
    })
    r.tasks.forEach((task, j) => {
      const taskId = crypto.randomUUID()
      const days = task.days ?? [1, 2, 3, 4, 5, 6, 7]
      tasks.push({
        id: taskId,
        routine_id: routineId,
        label: task.label,
        sort_order: j,
        tier: task.tier,
        scheduled_days: days,
        created_at: isoNDaysAgo(HISTORY_DAYS + 4),
      })
      if (r.active === false) return
      const [firstHour, spread] = ROUTINE_HOURS[i] ?? [12, 6]
      for (let ago = HISTORY_DAYS; ago >= 0; ago--) {
        if (!days.includes(isoWeekday(dayNDaysAgo(ago)))) continue
        const mix = (i * 31 + j * 17 + ago * 7) % 10
        let status: string | null = null
        if (ago === 0) {
          // this morning: the first two tasks are already ticked
          if (i === MORNING && j < 2) status = 'done'
        } else if (task.tier === 'bonus') {
          if (mix < 3) status = 'done'
        } else {
          // a habit settling in: patchier in the first weeks than lately,
          // with the odd conscious skip
          const steady = ago > 35 ? 5 : ago > 14 ? 6 : 7
          if (mix < steady) status = 'done'
          else if (mix === 9 && (i + j) % 2 === 0) status = 'skipped'
        }
        if (!status) continue
        const loggedAt =
          ago === 0
            ? new Date(Date.now() - (2 - j) * 20 * 60000).toISOString()
            : isoNDaysAgo(ago, firstHour + (j % spread), (j * 13 + ago * 7) % 60)
        taskLogs.push({
          id: crypto.randomUUID(),
          task_id: taskId,
          date: dateNDaysAgo(ago),
          status,
          completed_via: 'manual',
          notes: null,
          logged_at: loggedAt,
          created_at: loggedAt,
        })
      }
    })
  })

  data.routines = routines
  data.tasks = tasks
  data.task_logs = taskLogs

  const energy = ['medium', 'high', 'medium', 'low', 'medium', 'medium', 'high']
  data.daily_state = energy.map((level, k) => ({
    id: crypto.randomUUID(),
    date: dateNDaysAgo(k + 1),
    energy: level,
    created_at: isoNDaysAgo(k + 1, 8),
  }))

  // one of each kind: due today with a time, dated ahead, and undated. The
  // two tracker routines (last in the seed) are the reminder categories
  const errands = routines[routines.length - 1]
  const paperwork = routines[routines.length - 2]
  const reminder = (text: string, routine: Row | null, dueAgo: number | null, time: string | null, madeAgo: number) => ({
    id: crypto.randomUUID(),
    raw_text: text,
    ai_category: routine ? null : 'Other',
    ai_confidence: routine ? null : 0.9,
    final_category: routine ? routine.name : 'Other',
    routine_id: routine ? routine.id : null,
    status: routine ? 'reassigned' : 'auto',
    due_date: dueAgo === null ? null : dateNDaysAgo(dueAgo),
    due_time: time,
    created_at: isoNDaysAgo(madeAgo),
    updated_at: isoNDaysAgo(madeAgo),
  })
  data.reminders = [
    reminder(t.demo.reminder1, errands, 0, '18:00:00', 2),
    reminder(t.demo.reminder2, null, -3, null, 1),
    reminder(t.demo.reminder4, errands, -6, null, 3),
    reminder(t.demo.reminder3, paperwork, null, null, 4),
  ]

  data.ai_actions = [
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.aiExample1Text,
      actions: [
        { type: 'check_task', label: t.seed[MORNING].tasks[3].label, status: 'done' },
        { type: 'check_task', label: t.seed[MORNING].tasks[4].label, status: 'done' },
      ],
      status: 'confirmed',
      created_at: isoNDaysAgo(1, 9),
    },
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.aiExample2Text,
      actions: [{ type: 'log_cardio', kind: 'run', distance_km: 5, minutes: 32 }],
      status: 'applied',
      created_at: isoNDaysAgo(4, 18),
    },
  ]
}

// ---------- training ----------

// working weight per exercise: [kg in weeks 1-2, kg from week 3 on]. The
// first two weeks stay at one weight while the reps climb to the top of the
// range, then the load goes up - the progression the coach's note describes.
const LIFTS: Record<string, [number, number]> = {
  'Flat DB Bench Press': [24, 26],
  'Seated DB OHP': [16, 18],
  'Weighted Dip': [5, 7.5],
  'Cable Tricep Pushdown': [25, 27.5],
  'Weighted Lat Pulldown': [55, 60],
  'Chest-Supported DB Row': [22, 24],
  'Face Pull': [20, 22.5],
  'DB Hammer Curl': [12, 14],
  'Leg Press': [120, 130],
  'Hack Squat Machine': [60, 65],
  'Leg Extension': [45, 47.5],
  'Seated Calf Raise': [40, 45],
  'Incline DB Bench Press': [20, 22],
  'Cable Lateral Raise': [7.5, 10],
  'Pec Deck Fly': [40, 42.5],
  'Overhead Cable Extension': [20, 22.5],
  'Close-Grip Pulldown': [50, 55],
  'Seated Cable Row': [55, 60],
  'Reverse Fly Machine': [30, 32.5],
  'Incline DB Curl': [10, 12],
  'Hip Thrust': [80, 90],
  'Bulgarian Split Squat': [14, 16],
  'Lying Leg Curl': [35, 37.5],
  'Cable Pull-Through': [30, 32.5],
}

/** "4 x 8-10" -> 4 sets of 8 to 10; "5 x 5" -> 5 sets of 5; "Rest" -> none. */
function parseScheme(scheme: string | undefined): { sets: number; lo: number; hi: number } {
  const m = (scheme ?? '').match(/^\s*(\d+)\s*x\s*(\d+)(?:\s*-\s*(\d+))?/i)
  if (!m) return { sets: 0, lo: 0, hi: 0 }
  const lo = parseInt(m[2], 10)
  return { sets: parseInt(m[1], 10), lo, hi: m[3] ? parseInt(m[3], 10) : lo }
}

const phaseKey = (week: number) => (week <= 2 ? '1-2' : week <= 4 ? '3-4' : '5-6')

/** The starter plan with block 1 running: two full weeks trained, the third
 *  under way. Sessions and sets are laid out the way lib/blocks.ts generates
 *  them for a real account; the finished ones carry logged numbers. */
function seedTraining(data: Db) {
  const BLOCK_WEEKS = 6
  // the block began on the Monday two weeks before this week's
  const startAgo = isoWeekday() - 1 + 14

  const plans: Row[] = starterPlanRows(t.cues).map((p) => ({
    id: crypto.randomUUID(),
    ...p,
    created_at: isoNDaysAgo(startAgo, 8),
  }))
  data.workout_plans = plans

  const blockId = crypto.randomUUID()
  data.training_blocks = [
    {
      id: blockId,
      name: t.blocks.names[1] ?? t.blocks.fallback(1),
      block: 1,
      start_date: dateNDaysAgo(startAgo),
      total_weeks: BLOCK_WEEKS,
      created_at: isoNDaysAgo(startAgo, 8),
    },
  ]

  const blockPlans = starterPlanRows(t.cues).filter((p) => p.block === 1)
  // one session per split per week, Monday to Saturday; the rest day has no sets
  const splits = [...new Set(blockPlans.map((p) => p.split_day))].filter((s) =>
    blockPlans.some((p) => p.split_day === s && parseScheme(p.schemes['1-2']).sets > 0),
  )

  const sessions: Row[] = []
  const sets: Row[] = []
  const checkins: Row[] = []
  const cardio: Row[] = []
  const cardioLog = (ago: number, kind: string, km: number, minutes: number, hr: number | null, effort: string | null) =>
    cardio.push({
      id: crypto.randomUUID(),
      session_id: null,
      date: dateNDaysAgo(ago),
      kind,
      distance_km: km,
      minutes,
      avg_hr: hr,
      notes: null,
      effort,
      body: null,
      amount: kind === 'run' ? 'right' : null,
      created_at: isoNDaysAgo(ago, 13, 40),
    })
  // the easy run after each pull session, a little longer every week
  const RUN_KM = [4.2, 4.4, 4.6, 4.8, 5, 5]
  let runs = 0

  for (let week = 1; week <= BLOCK_WEEKS; week++) {
    splits.forEach((split, i) => {
      // a session is finished when its day is behind us; today's is up next
      const ago = startAgo - ((week - 1) * 7 + i)
      const done = ago > 0
      const sessionId = crypto.randomUUID()
      const splitPlans = blockPlans.filter((p) => p.split_day === split)
      const sessionCardio = splitPlans.find((p) => p.cardio)?.cardio ?? null
      sessions.push({
        id: sessionId,
        block_id: blockId,
        week_number: week,
        day_number: i + 1,
        split_day: split,
        cardio: sessionCardio,
        date: done ? dateNDaysAgo(ago) : null,
        completed_at: done ? isoNDaysAgo(ago, 13, 20) : null,
        created_at: isoNDaysAgo(startAgo, 8),
      })

      let order = 0
      const muscles = new Set<string>()
      for (const p of splitPlans) {
        const scheme = p.schemes[phaseKey(week)] ?? null
        const { sets: count, lo, hi } = parseScheme(scheme ?? undefined)
        const [early, later] = LIFTS[p.exercise] ?? [20, 22.5]
        for (let n = 1; n <= count; n++) {
          order++
          sets.push({
            id: crypto.randomUUID(),
            session_id: sessionId,
            sort_order: order,
            exercise: p.exercise,
            muscle_group: p.muscle_group,
            set_number: n,
            target_scheme: scheme,
            target_weight: null,
            logged_weight: done ? (week <= 2 ? early : later) : null,
            // later sets fall a rep or two short; a week on, fewer of them do
            logged_reps: done ? Math.max(lo, hi - Math.max(0, n - week)) : null,
            logged_at: done ? isoNDaysAgo(ago, 12, order * 3) : null,
            injury_note: null,
            created_at: isoNDaysAgo(startAgo, 8),
          })
        }
        if (count > 0 && p.muscle_group) muscles.add(p.muscle_group)
      }
      if (!done) return

      // the after-session check-in. Mostly "right"; quads found the first leg
      // day a stretch both weeks and biceps had room on the second pull day -
      // enough for the Progress tab to suggest one set fewer and one more
      for (const muscle of muscles) {
        const stretched = muscle === 'Quads' && split === 'Legs A' && week <= 2
        const hadRoom = muscle === 'Biceps' && split === 'Pull B' && week <= 2
        checkins.push({
          id: crypto.randomUUID(),
          session_id: sessionId,
          muscle_group: muscle,
          recovery: week === 1 ? 'ready_days_ago' : 'just_in_time',
          effort: stretched ? 'everything' : 'solid',
          amount: stretched ? 'stretch' : hadRoom ? 'could_take_more' : 'right',
          created_at: isoNDaysAgo(ago, 13, 20),
        })
      }
      if (sessionCardio) {
        const km = RUN_KM[Math.min(runs++, RUN_KM.length - 1)]
        cardioLog(ago, 'run', km, Math.round(km * 6.4), 150 + ((runs * 3) % 8), 'steady')
      }
    })
    // an easy walk on the rest day
    const sunday = startAgo - ((week - 1) * 7 + 6)
    if (sunday > 0) cardioLog(sunday, 'walk', 3.2, 44, null, 'easy')
  }

  // before the block: a short run and a walk most weeks
  for (let k = 1; startAgo + 7 * k - 5 <= HISTORY_DAYS; k++) {
    cardioLog(startAgo + 7 * k - 2, 'run', 3 + ((k * 3) % 10) / 10, 22 + (k % 3), 154 + (k % 4), 'steady')
    cardioLog(startAgo + 7 * k - 5, 'walk', 2.5 + (k % 2) * 0.6, 35 + (k % 2) * 8, null, 'easy')
  }

  data.planned_sessions = sessions
  data.planned_sets = sets
  data.recovery_checkins = checkins
  data.cardio_logs = cardio.filter((c) => String(c.date) >= dateNDaysAgo(HISTORY_DAYS))

  // two loose sessions typed into the message box the week before the block
  data.workout_logs = [
    { ago: startAgo + 2, ex: 'Flat DB Bench Press', muscle: 'Chest', sets: [{ kg: 22, reps: 10 }, { kg: 22, reps: 9 }, { kg: 22, reps: 8 }] },
    { ago: startAgo + 2, ex: 'Seated Cable Row', muscle: 'Back', sets: [{ kg: 50, reps: 12 }, { kg: 50, reps: 11 }] },
    { ago: startAgo + 4, ex: 'Leg Press', muscle: 'Quads', sets: [{ kg: 110, reps: 10 }, { kg: 110, reps: 10 }, { kg: 110, reps: 9 }] },
  ].map((w) => ({
    id: crypto.randomUUID(),
    date: dateNDaysAgo(w.ago),
    week_number: null,
    split_day: null,
    exercise: w.ex,
    target_scheme: null,
    sets: w.sets,
    notes: null,
    muscle_group: w.muscle,
    created_at: isoNDaysAgo(w.ago, 19),
  }))
}

// ---------- the whole thing ----------

export function seed(): Db {
  const data: Db = {}
  seedRoutines(data)
  seedTraining(data)

  // the AI's weekly notes, written for the week that just started
  const monday = dayNDaysAgo(isoWeekday() - 1)
  data.reflections = [
    { id: crypto.randomUUID(), week_start: localDate(monday), body: t.demo.reflection, created_at: isoNDaysAgo(0, 8) },
  ]
  data.training_reviews = [
    {
      id: crypto.randomUUID(),
      week_start: localDate(monday),
      body: t.demo.trainingBody,
      advice: t.demo.trainingAdvice,
      created_at: isoNDaysAgo(0, 8),
    },
  ]

  data.user_settings = []
  data.push_subscriptions = []

  return data
}
