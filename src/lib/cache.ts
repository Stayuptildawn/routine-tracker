import type { Reminder, Routine, TaskLog } from './types'
import type { CardioLog, PlannedSession, TrainingBlock, WorkoutLog, WorkoutPlan } from './types'
import type { AiAction } from './types'

type CacheEntry<T> = { data: T; at: number }

type AppCache = {
  now: CacheEntry<{ routines: Routine[]; logs: TaskLog[]; reminders: Reminder[] }> | null
  week: CacheEntry<{ routines: Routine[]; logs: TaskLog[] }> | null
  gym: CacheEntry<{ logs: WorkoutLog[]; plans: WorkoutPlan[]; block: TrainingBlock | null; sessions: PlannedSession[]; cardio: CardioLog[] }> | null
  reflect: CacheEntry<{ days: { date: string; dayName: string; done: number; skipped: number }[] }> | null
  history: CacheEntry<{ items: AiAction[]; counts: { kept: number; undone: number } | null }> | null
}

let cache: AppCache = { now: null, week: null, gym: null, reflect: null, history: null }

export function getCache<K extends keyof AppCache>(
  key: K,
  ttlMs: number,
): (AppCache[K] extends CacheEntry<infer T> | null ? T : never) | null {
  const entry = cache[key]
  if (!entry) return null
  if (Date.now() - entry.at > ttlMs) return null
  return (entry as CacheEntry<unknown>).data as never
}

export function setCache<K extends keyof AppCache>(
  key: K,
  data: AppCache[K] extends CacheEntry<infer T> | null ? T : never,
) {
  cache[key] = { data, at: Date.now() } as AppCache[K]
}

export function clearCache() {
  cache = { now: null, week: null, gym: null, reflect: null, history: null }
}
