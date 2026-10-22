import { describe, it, expect, vi, beforeEach } from 'vitest'

// Weak signal keeps navigator.onLine true while requests fail with status 0 -
// the case that used to lose Done/Skip taps. supabase-js is scripted: each
// request takes the next queued result.

type Res = { error: { message: string } | null; status: number }
const results: Res[] = []
const sent: unknown[] = []
const OK: Res = { error: null, status: 201 }
const NET: Res = { error: { message: 'TypeError: Load failed' }, status: 0 }
const SERVER: Res = { error: { message: 'violates foreign key' }, status: 409 }

vi.mock('../src/lib/supabase', () => {
  const builder = (payload: unknown) => {
    const b: Record<string, unknown> = {}
    for (const m of ['in', 'eq', 'abortSignal']) b[m] = () => b
    b.then = (resolve: (r: Res) => void) => {
      sent.push(payload)
      resolve(results.shift() ?? OK)
    }
    return b
  }
  return {
    supabase: {
      from: () => ({
        upsert: (v: unknown) => builder(v),
        insert: (v: unknown) => builder(v),
        update: (v: unknown) => builder(v),
        delete: () => builder('delete'),
      }),
    },
  }
})
vi.mock('../src/i18n', () => ({ t: {}, lang: 'en' }))

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})
vi.stubGlobal('navigator', { onLine: true })

const { setTaskStatus, flushTapQueue, pendingTaps } = await import('../src/lib/actions')
const { runOp, flushOps, pendingOpCount } = await import('../src/lib/offline')

beforeEach(() => {
  store.clear()
  results.length = 0
  sent.length = 0
})

describe('task taps on weak signal', () => {
  it('queues a tap whose request dropped, even while "online"', async () => {
    results.push(NET)
    expect(await setTaskStatus('t1', 'done', 'manual', '2026-10-22')).toBe('queued')
    expect(pendingTaps()).toEqual([{ task_id: 't1', date: '2026-10-22', status: 'done', via: 'manual' }])
  })

  it('still throws when the server itself refuses', async () => {
    results.push(SERVER)
    await expect(setTaskStatus('t1', 'done', 'manual', '2026-10-22')).rejects.toBeTruthy()
    expect(pendingTaps()).toEqual([])
  })

  it('keeps a queued tap when the retry hits bad signal again', async () => {
    results.push(NET)
    await setTaskStatus('t1', 'done', 'manual', '2026-10-22')
    results.push(NET)
    expect(await flushTapQueue()).toBe(0)
    expect(pendingTaps()).toHaveLength(1)
    results.push(OK)
    expect(await flushTapQueue()).toBe(1)
    expect(pendingTaps()).toEqual([])
  })

  it('a newer tap queues behind a waiting one, and the newest wins', async () => {
    results.push(NET)
    await setTaskStatus('t1', 'done', 'manual', '2026-10-22')
    // second tap on the same task while the first is still waiting
    results.push(NET) // the background flush it kicks off fails too
    expect(await setTaskStatus('t1', 'skipped', 'manual', '2026-10-22')).toBe('queued')
    await flushTapQueue()
    expect(pendingTaps().map((t) => t.status)).toEqual(['skipped'])
  })
})

describe('gym write queue on weak signal', () => {
  it('queues on a dropped request and drops only server rejections on replay', async () => {
    results.push(NET)
    expect(await runOp({ table: 'planned_sets', op: 'update', ids: ['s1'], values: { logged_reps: 8 } })).toBe('queued')
    expect(await runOp({ table: 'planned_sets', op: 'update', ids: ['s2'], values: { logged_reps: 9 } })).toBe('queued')
    results.length = 0
    results.push(SERVER, OK) // first is refused for good, second lands
    // runOp's own background flush may already be replaying - wait it out
    await flushOps()
    await flushOps()
    expect(pendingOpCount()).toBe(0)
  })
})
