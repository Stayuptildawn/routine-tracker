import { supabase } from './supabase'

// Offline write queue for the gym (bad reception territory): planned set
// logging, session state, check-ins and cardio entries queue when the
// network is down and replay FIFO on reconnect - same philosophy as the
// task tap queue, generalized. Inserts carry client-generated ids so the
// optimistic UI and the eventual row agree.

export interface WriteOp {
  table: string
  op: 'insert' | 'update' | 'delete'
  values?: Record<string, unknown> | Record<string, unknown>[]
  ids?: string[] // for update/delete by id
  match?: Record<string, string> // for update/delete by equality
}

const KEY = 'pending_ops'

/** Weak signal hangs a request instead of failing it - give up after this
 *  and treat it like being offline. */
export const WRITE_TIMEOUT_MS = 10_000

/** supabase-js never throws on a dropped connection or a timeout: it
 *  resolves with status 0. A real server answer always carries an HTTP
 *  status. Weak signal keeps navigator.onLine true, so this is the only
 *  reliable way to tell "retry later" from "the server said no". */
export function isNetworkFailure(res: { error: unknown; status?: number }): boolean {
  return !!res.error && (res.status === 0 || res.status === undefined)
}

function readQueue(): WriteOp[] {
  return JSON.parse(localStorage.getItem(KEY) ?? '[]')
}

function writeQueue(queue: WriteOp[]) {
  localStorage.setItem(KEY, JSON.stringify(queue))
}

export function pendingOpCount(): number {
  return readQueue().length
}

async function exec(op: WriteOp): Promise<void> {
  const signal = AbortSignal.timeout(WRITE_TIMEOUT_MS)
  let res: { error: { message: string } | null; status?: number }
  if (op.op === 'insert') {
    res = await supabase.from(op.table).insert(op.values ?? {}).abortSignal(signal)
  } else {
    let q =
      op.op === 'update'
        ? supabase.from(op.table).update(op.values ?? {})
        : supabase.from(op.table).delete()
    if (op.ids) q = q.in('id', op.ids)
    for (const [k, v] of Object.entries(op.match ?? {})) q = q.eq(k, v)
    res = await q.abortSignal(signal)
  }
  if (!res.error) return
  throw Object.assign(new Error(res.error.message), { server: !isNetworkFailure(res) })
}

function enqueue(op: WriteOp) {
  const queue = readQueue()
  // last-write-wins for repeated updates to the same single row
  if (op.op === 'update' && op.ids?.length === 1) {
    const prev = queue.findIndex(
      (q) => q.op === 'update' && q.table === op.table && q.ids?.length === 1 && q.ids[0] === op.ids![0],
    )
    if (prev !== -1) {
      queue[prev] = { ...op, values: { ...(queue[prev].values as object), ...(op.values as object) } }
      writeQueue(queue)
      return
    }
  }
  queue.push(op)
  writeQueue(queue)
}

/** Run a write now, or queue it when the network can't carry it. */
export async function runOp(op: WriteOp): Promise<'saved' | 'queued'> {
  // earlier writes still waiting: this one must land after them, not before
  if (readQueue().length > 0) {
    enqueue(op)
    void flushOps()
    return 'queued'
  }
  try {
    await exec(op)
    return 'saved'
  } catch (err) {
    if (!navigator.onLine || !(err as { server?: boolean }).server) {
      enqueue(op)
      return 'queued'
    }
    throw err
  }
}

let flushing: Promise<number> | null = null

/** Replay queued writes in order. Server rejections are dropped (retrying
 *  can never succeed); network failures put the rest back for next time. */
export function flushOps(): Promise<number> {
  // one replay at a time - overlapping ones would send the same op twice
  flushing ??= replay().finally(() => (flushing = null))
  return flushing
}

async function replay(): Promise<number> {
  let done = 0
  // writes queued while this replay ran land in storage - go round again
  for (;;) {
    const queue = readQueue()
    if (queue.length === 0 || !navigator.onLine) return done
    writeQueue([])
    for (let i = 0; i < queue.length; i++) {
      try {
        await exec(queue[i])
        done++
      } catch (err) {
        if ((err as { server?: boolean }).server) continue // dropped
        writeQueue([...queue.slice(i), ...readQueue()])
        return done
      }
    }
  }
}
