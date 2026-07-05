// send-nudges: pg_cron every 15 minutes. A routine whose anchor_time falls in
// the last 15-minute window, with core tasks still pending today, gets ONE
// web push - and never a second one that day (nudges_sent ledger).
//
// Copy rule: an invitation, never an accusation. "X is ready when you are."
// The words "missed", "late", "still" and counts of undone things are banned.
//
// Deploy with verify_jwt OFF; authenticated by x-cron-secret like
// weekly-reflection. Service role: all queries scope by ids we own.
//
// Secrets: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:you@x),
// CRON_SECRET, USER_TIMEZONE.

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3'
import { addDays, userNow } from '../_shared/localtime.ts'

const WINDOW_MIN = 15 // must match the cron cadence
const REMINDER_WINDOW_START = 9 * 60 // due-today reminders go out after 09:00 local

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.headers.get('x-cron-secret') !== Deno.env.get('CRON_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    webpush.setVapidDetails(
      Deno.env.get('VAPID_SUBJECT')!,
      Deno.env.get('VAPID_PUBLIC_KEY')!,
      Deno.env.get('VAPID_PRIVATE_KEY')!,
    )
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // each user lives in their own timezone
    const { data: settingsRows } = await supabase.from('user_settings').select('user_id, timezone')
    const tzOf = new Map((settingsRows ?? []).map((r) => [r.user_id, r.timezone]))
    const nowCache = new Map<string, { date: string; weekday: number; minutes: number }>()
    const nowFor = (userId: string) => {
      if (!nowCache.has(userId)) nowCache.set(userId, userNow(tzOf.get(userId)))
      return nowCache.get(userId)!
    }

    const { data: routines } = await supabase
      .from('routines')
      .select('id, name, user_id, anchor_time, tasks(id, tier, scheduled_days)')
      .not('anchor_time', 'is', null)

    let sent = 0
    for (const routine of routines ?? []) {
      const { date, weekday, minutes } = nowFor(routine.user_id)
      const [h, m] = (routine.anchor_time as string).split(':').map(Number)
      const anchorMin = h * 60 + m
      // fire in the window just after the anchor; one cron tick wide
      if (minutes < anchorMin || minutes >= anchorMin + WINDOW_MIN) continue

      const coreToday = (routine.tasks ?? []).filter(
        (t) => t.tier === 'core' && t.scheduled_days?.includes(weekday),
      )
      if (coreToday.length === 0) continue

      const { data: logs } = await supabase
        .from('task_logs')
        .select('task_id, status')
        .eq('date', date)
        .in('task_id', coreToday.map((t) => t.id))
      const handled = new Set((logs ?? []).filter((l) => l.status !== 'pending').map((l) => l.task_id))
      if (coreToday.every((t) => handled.has(t.id))) continue // already done - no nudge

      // dedupe: first insert wins, a second run the same day gets a conflict
      const { error: dupe } = await supabase.from('nudges_sent').insert({ routine_id: routine.id, date })
      if (dupe) continue

      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, p256dh, auth')
        .eq('user_id', routine.user_id)

      const payload = JSON.stringify({
        title: 'Routine Tracker',
        body: `${routine.name} is ready when you are.`,
        tag: `nudge-${routine.id}`, // replaces, never stacks
      })

      for (const sub of subs ?? []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
          )
          sent++
        } catch (err: unknown) {
          const status = (err as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) {
            // subscription expired or revoked - clean it up
            await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          } else {
            console.error('push failed:', status, err)
          }
        }
      }
    }

    // due-today reminders: one push each, in the first morning tick of the
    // user's own timezone. "Due today", never "overdue".
    {
      const utcToday = new Date().toISOString().slice(0, 10)
      const { data: dueReminders } = await supabase
        .from('reminders')
        .select('id, user_id, raw_text, due_date, nudged_at')
        .in('status', ['auto', 'reassigned'])
        .gte('due_date', addDays(utcToday, -1))
        .lte('due_date', addDays(utcToday, 1))
      const byUser = new Map<string, { id: string; raw_text: string }[]>()
      for (const r of dueReminders ?? []) {
        const { date, minutes } = nowFor(r.user_id)
        if (r.due_date !== date) continue // not "today" where this user lives
        if (minutes < REMINDER_WINDOW_START || minutes >= REMINDER_WINDOW_START + WINDOW_MIN) continue
        if (r.nudged_at && r.nudged_at >= date + 'T00:00:00') continue // already nudged today
        const list = byUser.get(r.user_id) ?? []
        list.push(r)
        byUser.set(r.user_id, list)
      }
      for (const [userId, items] of byUser) {
        const { data: subs } = await supabase
          .from('push_subscriptions')
          .select('endpoint, p256dh, auth')
          .eq('user_id', userId)
        if (!subs || subs.length === 0) continue
        const body =
          items.length === 1
            ? `🔔 Due today: ${items[0].raw_text}`
            : `🔔 Due today: ${items[0].raw_text} (+${items.length - 1} more)`
        const payload = JSON.stringify({ title: 'Routine Tracker', body, tag: 'reminders-due' })
        let delivered = 0
        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
              payload,
            )
            delivered++
            sent++
          } catch (err: unknown) {
            const status = (err as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) {
              await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
            } else {
              console.error('reminder push failed:', status, err)
            }
          }
        }
        if (delivered > 0) {
          await supabase
            .from('reminders')
            .update({ nudged_at: new Date().toISOString() })
            .in('id', items.map((r) => r.id))
        }
      }
    }

    return json({ sent })
  } catch (err) {
    console.error('send-nudges error:', err)
    return json({ error: String(err) }, 500)
  }
})
