// The offline queues (pending_ops, pending_messages, pending_taps) belong to
// the account that wrote them. Their storage keys carry the signed-in user's
// id, so a write queued under one account can never replay under another on
// the same browser, and the demo's fake session can't drain a real queue.
// Nothing is dropped on sign-out: the entries wait under their owner's key
// and replay when that person signs back in.

const BASES = ['pending_ops', 'pending_messages', 'pending_taps'] as const
export type QueueBase = (typeof BASES)[number]

let owner: string | null = null

/** Called whenever the session changes, before anything reads a queue. */
export function setQueueOwner(userId: string | null) {
  owner = userId
  if (userId) adoptLegacyQueues(userId)
}

/** Storage key for this user's queue; null while signed out (queues read as
 *  empty and writes are refused). */
export function queueKey(base: QueueBase): string | null {
  return owner ? `${base}:${owner}` : null
}

/** Before this change the keys had no owner. The first account to sign in
 *  after the update takes over whatever was waiting, so nothing is lost. */
function adoptLegacyQueues(userId: string) {
  for (const base of BASES) {
    const legacy = localStorage.getItem(base)
    if (legacy === null) continue
    try {
      const old = JSON.parse(legacy) as unknown[]
      if (Array.isArray(old) && old.length > 0) {
        const key = `${base}:${userId}`
        const mine = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown[]
        localStorage.setItem(key, JSON.stringify([...old, ...mine]))
      }
    } catch {
      /* unreadable leftovers - nothing worth keeping */
    }
    localStorage.removeItem(base)
  }
}
