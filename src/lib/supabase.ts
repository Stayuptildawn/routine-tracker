import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_API_KEY as string | undefined

/** False until .env (or CI secrets) provide the Supabase credentials. */
export const configured = Boolean(url && key)

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder-key',
)
