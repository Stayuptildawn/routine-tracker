import { supabase } from './supabase'
import { disableNudges } from './push'

/** Sign out, and first take this browser off the push list while the session
 *  can still delete its row - otherwise the next person on this device keeps
 *  receiving the previous account's reminders. Bad signal never blocks the
 *  sign-out itself. */
export async function signOut(): Promise<void> {
  try {
    await Promise.race([
      disableNudges(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ])
  } catch {
    /* offline or slow: the SIGNED_OUT handler still drops the browser subscription */
  }
  await supabase.auth.signOut()
}
