import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

// The Settings switch for in-app cardio logging, shared by every screen that
// shows cardio. Cached locally so the first paint already knows (no cardio
// tab flashing in and out on launch); the server row is the truth and is
// re-read on each app start.

const KEY = 'cardio-tracking'
const listeners = new Set<() => void>()

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== '0'
  } catch {
    return true
  }
}

let value = read()

function set(next: boolean) {
  if (next === value) return
  value = next
  try {
    localStorage.setItem(KEY, next ? '1' : '0')
  } catch {
    // private mode: the in-memory value still drives this session
  }
  listeners.forEach((l) => l())
}

/** Pull the saved choice from the server (a missing row means on). */
export async function refreshCardioTracking() {
  const { data, error } = await supabase.from('user_settings').select('cardio_tracking').maybeSingle()
  if (!error) set(data?.cardio_tracking !== false)
}

/** Flip the switch: the UI follows at once, the server catches up. */
export async function saveCardioTracking(on: boolean) {
  set(on)
  await supabase
    .from('user_settings')
    .upsert({ cardio_tracking: on, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
    .then(() => {}, () => {})
}

export function useCardioTracking(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => value,
  )
}
