// Unit tests for the interpret APPLY logic - everything that happens after
// Gemini answers: trust thresholds, dedupe, the action cap, deterministic
// time fallbacks, planned-set filling and reminder clearing. The model is
// stubbed; the database is an in-memory fake (tests/fakeSupabase.ts), so
// this covers the app's most regression-prone path without a network.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeDb } from './fakeSupabase'

const gemini = vi.hoisted(() => ({
  reply: null as { actions: Record<string, unknown>[] } | null,
  error: '',
}))

vi.mock('../supabase/functions/_shared/gemini.ts', () => ({
  GEMINI_MODELS: ['fake-model'],
  askGemini: vi.fn(async () => ({ text: null, model: null, error: 'not used' })),
  askGeminiJson: vi.fn(async () => ({ data: gemini.reply, error: gemini.error })),
}))

import { interpretAndApply } from '../supabase/functions/_shared/interpret'

const USER = 'user-1'
const TODAY = '2026-07-17' // a Friday
const WEEKDAY = 5
const CLOCK = '14:00'

function makeDb() {
  const db = new FakeDb()
  db.seed('routines', [
    {
      id: 'r1',
      user_id: USER,
      name: 'Morning',
      active: true,
      tasks: [
        { id: 't1', label: 'Take meds', tier: 'core', scheduled_days: [1, 2, 3, 4, 5, 6, 7] },
        { id: 't2', label: 'Drink water', tier: 'core', scheduled_days: [1, 2, 3, 4, 5, 6, 7] },
        { id: 't3', label: 'Do the dishes', tier: 'standard', scheduled_days: [6] }, // not scheduled today
      ],
    },
  ])
  db.seed('reminders', [
    {
      id: 'rem1',
      user_id: USER,
      raw_text: 'Buy sunscreen',
      status: 'auto',
      due_date: null,
      due_time: null,
      created_at: '2026-07-16T10:00:00Z',
    },
  ])
  return db
}

function run(db: FakeDb, text: string) {
  return interpretAndApply(db.client(), USER, text, TODAY, WEEKDAY, CLOCK, 'en')
}

beforeEach(() => {
  gemini.reply = null
  gemini.error = ''
})

describe('trust thresholds', () => {
  it('applies a confident check and records the undo batch', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'check_task', task_id: 't1', status: 'done', confidence: 0.95 }] }
    const res = await run(db, 'took my meds')
    expect(res.applied).toHaveLength(1)
    expect(res.applied[0]).toMatchObject({ type: 'check_task', label: 'Take meds', log_date: TODAY })
    expect(db.rows('task_logs')[0]).toMatchObject({ task_id: 't1', date: TODAY, status: 'done', completed_via: 'ai_text' })
    expect(res.ai_action_id).toBeTruthy()
    expect(db.rows('ai_actions')).toHaveLength(1)
  })

  it('returns a mid-confidence match as a suggestion and writes nothing', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'check_task', task_id: 't1', status: 'done', confidence: 0.7 }] }
    const res = await run(db, 'took my meds maybe')
    expect(res.applied).toHaveLength(0)
    expect(res.suggestions).toHaveLength(1)
    expect(res.suggestions[0]).toMatchObject({ task_id: 't1', label: 'Take meds' })
    expect(db.rows('task_logs')).toHaveLength(0)
    expect(res.ai_action_id).toBeNull()
  })

  it('drops a low-confidence match entirely', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'check_task', task_id: 't1', status: 'done', confidence: 0.4 }] }
    const res = await run(db, 'something vague')
    expect(res.applied).toHaveLength(0)
    expect(res.suggestions).toHaveLength(0)
    expect(db.rows('task_logs')).toHaveLength(0)
  })

  it('never applies an invented task_id', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'check_task', task_id: 'not-a-task', status: 'done', confidence: 0.99 }] }
    const res = await run(db, 'did the thing')
    expect(res.applied).toHaveLength(0)
    expect(db.rows('task_logs')).toHaveLength(0)
  })
})

describe('model-output hygiene', () => {
  it('collapses identical duplicate actions into one', async () => {
    const db = makeDb()
    const action = { type: 'check_task', task_id: 't1', status: 'done', confidence: 0.95 }
    gemini.reply = { actions: [action, { ...action }] }
    const res = await run(db, 'took my meds')
    expect(res.applied).toHaveLength(1)
    expect(db.rows('task_logs')).toHaveLength(1)
  })

  it('caps a runaway action list at 10', async () => {
    const db = makeDb()
    gemini.reply = {
      actions: Array.from({ length: 12 }, (_, i) => ({
        type: 'create_reminder',
        reminder_text: `Errand number ${i}`,
        category: 'Other',
        confidence: 0.95,
      })),
    }
    const res = await run(db, 'a flood of reminders')
    expect(res.applied).toHaveLength(10)
    expect(db.rows('reminders')).toHaveLength(11) // 10 new + 1 seeded
  })

  it('surfaces a whole-chain Gemini failure as an error, touching nothing', async () => {
    const db = makeDb()
    gemini.reply = null
    gemini.error = 'fake-model: HTTP 500'
    const res = await run(db, 'took my meds')
    expect(res.error).toContain('Gemini error')
    expect(db.rows('task_logs')).toHaveLength(0)
    expect(db.rows('ai_actions')).toHaveLength(0)
  })
})

describe('deterministic time handling', () => {
  it('lands "yesterday" on yesterday even when the model drops days_ago', async () => {
    const db = makeDb()
    // t3 is not scheduled today - only reachable through the past-day path
    gemini.reply = { actions: [{ type: 'check_task', task_id: 't3', status: 'done', confidence: 0.95 }] }
    const res = await run(db, 'did the dishes yesterday')
    expect(res.applied).toHaveLength(1)
    expect(db.rows('task_logs')[0]).toMatchObject({ task_id: 't3', date: '2026-07-16' })
  })

  it('resolves "in 10 mins" against the caller clock when the model omits it', async () => {
    const db = makeDb()
    gemini.reply = {
      actions: [{ type: 'create_reminder', reminder_text: 'Call the bank', category: 'Other', confidence: 0.9 }],
    }
    const res = await run(db, 'remind me to call the bank in 10 mins')
    expect(res.applied).toHaveLength(1)
    expect(res.applied[0]).toMatchObject({ due_time: '14:10', due_date: TODAY })
  })

  it('resolves "tomorrow at 5pm" when the model omits both fields', async () => {
    const db = makeDb()
    gemini.reply = {
      actions: [{ type: 'create_reminder', reminder_text: 'Email the lawyer', category: 'Other', confidence: 0.9 }],
    }
    const res = await run(db, 'remind me to email the lawyer tomorrow at 5pm')
    expect(res.applied[0]).toMatchObject({ due_time: '17:00', due_date: '2026-07-18' })
  })

  it('backfills cardio numbers from the text when the model drops them', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'log_cardio', kind: 'run', effort: 'easy', confidence: 0.95 }] }
    const res = await run(db, 'ran 5k in 25 min at 152 bpm, felt easy')
    expect(res.applied).toHaveLength(1)
    expect(db.rows('cardio_logs')[0]).toMatchObject({
      distance_km: 5,
      minutes: 25,
      avg_hr: 152,
      effort: 'easy',
      kind: 'run',
    })
  })
})

describe('reminders', () => {
  it('clears a matching reminder only at high confidence, keeping undo state', async () => {
    const db = makeDb()
    gemini.reply = {
      actions: [{ type: 'complete_reminder', reminder_id: 'rem1', reminder_status: 'done', confidence: 0.8 }],
    }
    let res = await run(db, 'bought the sunscreen, I think')
    expect(res.applied).toHaveLength(0)
    expect(db.rows('reminders')[0].status).toBe('auto')

    gemini.reply = {
      actions: [{ type: 'complete_reminder', reminder_id: 'rem1', reminder_status: 'done', confidence: 0.95 }],
    }
    res = await run(db, 'bought the sunscreen')
    expect(res.applied[0]).toMatchObject({ reminder_id: 'rem1', reminder_status: 'done', prev_status: 'auto' })
    expect(db.rows('reminders')[0].status).toBe('done')
  })

  it('answers a pending-reminders question without writing anything', async () => {
    const db = makeDb()
    gemini.reply = { actions: [{ type: 'query_reminders', confidence: 0.95 }] }
    const res = await run(db, "what's on my list?")
    expect(res.answers).toHaveLength(1)
    expect(res.answers[0]).toContain('Buy sunscreen')
    expect(res.ai_action_id).toBeNull()
    expect(db.rows('ai_actions')).toHaveLength(0)
  })
})

describe('workout routing', () => {
  it("fills today's open planned session and completes it when full", async () => {
    const db = makeDb()
    db.seed('planned_sessions', [{ id: 's1', user_id: USER, date: TODAY, completed_at: null, split_day: 'Push' }])
    db.seed('planned_sets', [
      { id: 'ps1', session_id: 's1', user_id: USER, exercise: 'Bench Press', logged_at: null, sort_order: 1 },
      { id: 'ps2', session_id: 's1', user_id: USER, exercise: 'Bench Press', logged_at: null, sort_order: 2 },
    ])
    gemini.reply = {
      actions: [
        {
          type: 'log_workout',
          exercise: 'bench press',
          sets: [
            { kg: 60, reps: 8 },
            { kg: 60, reps: 8 },
          ],
          confidence: 0.95,
        },
      ],
    }
    const res = await run(db, 'bench 60 2x8')
    expect(res.applied[0]).toMatchObject({ type: 'log_workout', split_day: 'Push' })
    expect(res.applied[0].planned_set_ids).toHaveLength(2)
    expect(db.rows('planned_sets').every((s) => s.logged_weight === 60 && s.logged_reps === 8)).toBe(true)
    expect(db.rows('planned_sessions')[0].completed_at).toBeTruthy()
    expect(db.rows('workout_logs')).toHaveLength(0) // planned path, not freeform
  })

  it('routes an off-plan lift to the freeform log with plan-inferred context', async () => {
    const db = makeDb()
    db.seed('workout_plans', [
      { user_id: USER, split_day: 'Pull', exercise: 'Hammer Curl', schemes: { '1-2': '3x12' }, muscle_group: 'Biceps' },
    ])
    db.seed('training_blocks', [{ user_id: USER, start_date: '2026-07-06', created_at: '2026-07-06T08:00:00Z' }])
    gemini.reply = {
      actions: [{ type: 'log_workout', exercise: 'Hammer Curls', sets: [{ kg: 14, reps: 12 }], confidence: 0.9 }],
    }
    const res = await run(db, 'hammer curls 14kg 3x12')
    expect(res.applied).toHaveLength(1)
    expect(db.rows('workout_logs')[0]).toMatchObject({
      exercise: 'Hammer Curls',
      split_day: 'Pull',
      muscle_group: 'Biceps',
      week_number: 2, // 2026-07-17 is in the block's second week
      target_scheme: '3x12',
    })
  })
})
