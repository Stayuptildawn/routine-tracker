// telegram-webhook: text a Telegram bot, get the same interpret+apply as the
// in-app composer. Deploy with verify_jwt OFF (Telegram sends no JWT); the
// request is authenticated by the x-telegram-bot-api-secret-token header set
// when registering the webhook.
//
// Secrets: TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, TELEGRAM_LINK_CODE,
// USER_TIMEZONE (IANA name, e.g. Europe/Berlin; defaults to UTC).
//
// One-time linking: message the bot "/link <TELEGRAM_LINK_CODE>". Single-user
// by design - it links to the project's only auth user and refuses otherwise.
//
// SECURITY: this runs with the service role, so RLS does not apply. All data
// access goes through interpretAndApply, which scopes every query by the
// linked user_id. Keep it that way.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { interpretAndApply, describeApplied } from '../_shared/interpret.ts'

const ok = () => new Response('ok') // Telegram retries anything else - always 200

async function reply(chatId: number, text: string) {
  await fetch(`https://api.telegram.org/bot${Deno.env.get('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
}

/** Today's yyyy-mm-dd and ISO weekday (1=Mon) in the user's timezone. */
function localToday(): { date: string; weekday: number } {
  const tz = Deno.env.get('USER_TIMEZONE') ?? 'UTC'
  const now = new Date()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now)
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(day) + 1
  return { date, weekday }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-telegram-bot-api-secret-token') !== Deno.env.get('TELEGRAM_WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    const update = await req.json()
    const message = update.message
    const chatId: number | undefined = message?.chat?.id
    const text: string | undefined = message?.text
    if (!chatId || !text) return ok() // edits, stickers, joins... ignore quietly

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    if (text.startsWith('/start')) {
      await reply(chatId, 'Hi. Link me to your tracker first: /link <your-link-code>')
      return ok()
    }

    if (text.startsWith('/link')) {
      const code = text.slice('/link'.length).trim()
      if (!code || code !== Deno.env.get('TELEGRAM_LINK_CODE')) {
        await reply(chatId, 'That code didn’t match. Usage: /link <your-link-code>')
        return ok()
      }
      const { data: users } = await supabase.auth.admin.listUsers({ perPage: 2 })
      if (!users || users.users.length !== 1) {
        await reply(chatId, 'Linking needs exactly one app user - this bot is single-user.')
        return ok()
      }
      await supabase.from('telegram_links').upsert({ chat_id: chatId, user_id: users.users[0].id })
      await reply(chatId, 'Linked ✓ — just text me things like "took my meds" or "remind me to call the bank".')
      return ok()
    }

    const { data: link } = await supabase.from('telegram_links').select('user_id').eq('chat_id', chatId).maybeSingle()
    if (!link) {
      await reply(chatId, 'We’re not linked yet — send /link <your-link-code> first.')
      return ok()
    }

    const { date, weekday } = localToday()
    const result = await interpretAndApply(supabase, link.user_id, text, date, weekday)

    if (result.error) {
      await reply(chatId, 'Something went wrong on my end — try again in a minute.')
    } else {
      const lines = result.applied.map(describeApplied)
      if (result.suggestions.length > 0) {
        const maybes = result.suggestions
          .map((s) => `${s.status === 'skipped' ? '⏭' : '✓'} ${s.label}`)
          .join(', ')
        lines.push(`Not sure about: ${maybes} — confirm in the app if I got it right.`)
      }
      if (lines.length === 0) lines.push('Nothing matched — try naming the task, or say "remind me to…".')
      await reply(chatId, lines.join('\n'))
    }
    return ok()
  } catch {
    return ok() // never make Telegram retry-loop
  }
})
