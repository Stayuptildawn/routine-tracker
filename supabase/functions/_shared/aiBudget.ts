// Per-user daily budget for the AI calls a signed-in user can trigger. Every
// Gemini call is paid from one operator key, so one account must not be able
// to spend everyone's quota. The counter lives in ai_usage (0031) and is only
// reachable through claim_ai_call, which counts against auth.uid() - the
// client passed in must carry the caller's own JWT.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.110.0'

/** Calls per user per UTC day. Generous for a person, tiny for a script. */
export const AI_DAILY_LIMIT = {
  interpret: 150,
  'refresh-coach': 12,
} as const

export type AiKind = keyof typeof AI_DAILY_LIMIT

/** Counts one call; false once today's budget is spent. Fails closed: if the
 *  counter can't be reached, no paid call goes out. */
export async function claimAiCall(supabase: SupabaseClient, kind: AiKind): Promise<boolean> {
  const { data, error } = await supabase.rpc('claim_ai_call', { p_kind: kind, p_limit: AI_DAILY_LIMIT[kind] })
  if (error) {
    console.error('claim_ai_call failed:', error.message)
    return false
  }
  return data === true
}
