import { createClient } from '@supabase/supabase-js'

/** Tolerate common paste mistakes in env values: whitespace, quotes, missing scheme. */
function clean(value: string | undefined): string | undefined {
  const s = value?.trim().replace(/^["']|["']$/g, '')
  return s || undefined
}

const rawUrl = clean(import.meta.env.VITE_SUPABASE_URL)
const url = rawUrl && !/^https?:\/\//.test(rawUrl) ? `https://${rawUrl}` : rawUrl
const key = clean(import.meta.env.VITE_SUPABASE_API_KEY)

function isValidUrl(u: string | undefined): u is string {
  try {
    return Boolean(u) && Boolean(new URL(u!))
  } catch {
    return false
  }
}

/** False until .env (or CI secrets) provide usable Supabase credentials. */
export const configured = isValidUrl(url) && Boolean(key)

export const supabase = createClient(
  configured ? url! : 'https://placeholder.supabase.co',
  configured ? key! : 'placeholder-key',
)
