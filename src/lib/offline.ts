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

function readQueue(): WriteOp[] {
  return JSON.parse(localStorage.getItem(KEY) ?? '[]')
}

function writeQueue(queue: WriteOp[]) {
  localStorage.setItem(KEY, JSON.stringify(queue))
}

async function exec(op: WriteOp): Promise<void> {
  if (op.op === 'insert') {
    const { error } = await supabase.from(op.table).insert(op.values ?? {})
    if (error) throw Object.assign(new Error(error.message), { server: true })
    return
  }
  let q =
    op.op === 'update'
      ? supabase.from(op.table).update(op.values ?? {})
      : supabase.from(op.table).delete()
  if (op.ids) q = q.in('id', op.ids)
  for (const [k, v] of Object.entries(op.match ?? {})) q = q.eq(k, v)
  const { error } = await q
  if (error) throw Object.assign(new Error(error.message), { server: true })
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

/** Run a write now, or queue it when offline. */
export async function runOp(op: WriteOp): Promise<'saved' | 'queued'> {
  try {
    await exec(op)
    return 'saved'
  } catch (err) {
    if (!navigator.onLine) {
      enqueue(op)
      return 'queued'
    }
    throw err
  }
}

/** Replay queued writes in order. Server rejections are dropped (retrying
 *  can never succeed); network failures put the rest back for next time. */
export async function flushOps(): Promise<number> {
  const queue = readQueue()
  if (queue.length === 0 || !navigator.onLine) return 0
  writeQueue([])
  let done = 0
  for (let i = 0; i < queue.length; i++) {
    try {
      await exec(queue[i])
      done++
    } catch (err) {
      if ((err as { server?: boolean }).server) continue // dropped
      writeQueue([...queue.slice(i), ...readQueue()])
      break
    }
  }
  return done
}
