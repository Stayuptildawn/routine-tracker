// send-nudges: pg_cron every 5 minutes. A routine whose anchor_time falls in
// the last cron-tick window, with core tasks still pending today, gets ONE
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

import { createClient } from 'npm:@supabase/supabase-js@2.110.0'
import { json, secretMatches } from '../_shared/http.ts'
import { pushToUser, setVapid, type PushSub } from '../_shared/push.ts'
import { selectAll } from '../_shared/db.ts'
import { addDays, userNow } from '../_shared/localtime.ts'
import { normLang, SERVER_STRINGS } from '../_shared/lang.ts'

const WINDOW_MIN = 5 // must match the cron cadence
// a timed reminder keeps trying for this long past its hour, so one slow or
// skipped cron tick can't eat it (nudged_at stops any repeat once delivered)
const TIMED_TOLERANCE_MIN = 15
const REMINDER_WINDOW_START = 9 * 60 // due-today reminders go out after 09:00 local
const REFLECT_PUSH_MIN = 21 * 60 + 30 // 21:30 local - half an hour before the nightly reflection reads the day

Deno.serve(async (req) => {
  if (!(await secretMatches(req.headers.get('x-cron-secret'), Deno.env.get('CRON_SECRET')))) {
    return new Response('forbidden', { status: 403 })
  }

  try {
    setVapid()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // every cross-user read pages (selectAll): one account inserting many rows
    // must not push other users' rows past PostgREST's 1000-row cap

    // each user lives in their own timezone and language
    const settingsRows = await selectAll<{ user_id: string; timezone: string | null; language: string | null }>(() =>
      supabase.from('user_settings').select('user_id, timezone, language').order('user_id'),
    )
    const tzOf = new Map(settingsRows.map((r) => [r.user_id, r.timezone ?? undefined]))
    const langOf = new Map(settingsRows.map((r) => [r.user_id, r.language]))
    const strFor = (userId: string) => SERVER_STRINGS[normLang(langOf.get(userId))]
    const nowCache = new Map<string, { date: string; weekday: number; minutes: number }>()
    const nowFor = (userId: string) => {
      if (!nowCache.has(userId)) nowCache.set(userId, userNow(tzOf.get(userId)))
      return nowCache.get(userId)!
    }

    type Routine = {
      id: string
      name: string
      user_id: string
      anchor_time: string
      tasks: { id: string; tier: string; scheduled_days: number[] | null }[] | null
    }
    const routines = await selectAll<Routine>(() =>
      supabase
        .from('routines')
        .select('id, name, user_id, anchor_time, tasks(id, tier, scheduled_days)')
        .not('anchor_time', 'is', null)
        .eq('active', true)
        .order('id'),
    )

    const subsOf = async (userId: string): Promise<PushSub[]> => {
      const { data } = await supabase.from('push_subscriptions').select('endpoint, p256dh, auth').eq('user_id', userId)
      return data ?? []
    }

    let sent = 0
    for (const routine of routines) {
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

      const payload = JSON.stringify({
        title: 'Routine Tracker',
        body: strFor(routine.user_id).routineReady(routine.name),
        tag: `nudge-${routine.id}`, // replaces, never stacks
      })
      sent += await pushToUser(supabase, routine.user_id, await subsOf(routine.user_id), payload, 'routine')
    }

    // due-today reminders: one push each. A reminder with a due_time fires in
    // the 15-minute window at that local hour; the rest go out together in the
    // first morning tick of the user's own timezone. "Due today", never "overdue".
    {
      const utcToday = new Date().toISOString().slice(0, 10)
      type Due = { id: string; user_id: string; raw_text: string; due_date: string; due_time: string | null; nudged_at: string | null }
      const dueReminders = await selectAll<Due>(() =>
        supabase
          .from('reminders')
          .select('id, user_id, raw_text, due_date, due_time, nudged_at')
          .in('status', ['auto', 'reassigned'])
          .gte('due_date', addDays(utcToday, -1))
          .lte('due_date', addDays(utcToday, 1))
          .order('id'),
      )
      const byUser = new Map<string, { id: string; raw_text: string }[]>()
      const timed: { id: string; user_id: string; raw_text: string }[] = []
      for (const r of dueReminders) {
        const { date, minutes } = nowFor(r.user_id)
        if (r.due_date !== date) continue // not "today" where this user lives
        if (r.nudged_at && r.nudged_at >= date + 'T00:00:00') continue // already nudged today
        if (r.due_time) {
          const [h, m] = (r.due_time as string).split(':').map(Number)
          const dueMin = h * 60 + m
          if (minutes < dueMin || minutes >= dueMin + TIMED_TOLERANCE_MIN) continue
          timed.push(r)
        } else {
          if (minutes < REMINDER_WINDOW_START || minutes >= REMINDER_WINDOW_START + WINDOW_MIN) continue
          const list = byUser.get(r.user_id) ?? []
          list.push(r)
          byUser.set(r.user_id, list)
        }
      }

      // timed reminders: each gets its own push at its own hour
      for (const r of timed) {
        const subs = await subsOf(r.user_id)
        if (subs.length === 0) continue
        const payload = JSON.stringify({
          title: 'Routine Tracker',
          body: `🔔 ${r.raw_text}`,
          tag: `reminder-${r.id}`, // replaces, never stacks
        })
        const delivered = await pushToUser(supabase, r.user_id, subs, payload, 'timed reminder')
        sent += delivered
        if (delivered > 0) {
          await supabase.from('reminders').update({ nudged_at: new Date().toISOString() }).eq('id', r.id)
        }
      }
      for (const [userId, items] of byUser) {
        const subs = await subsOf(userId)
        if (subs.length === 0) continue
        const body = strFor(userId).dueToday(items[0].raw_text, items.length - 1)
        const payload = JSON.stringify({ title: 'Routine Tracker', body, tag: 'reminders-due' })
        const delivered = await pushToUser(supabase, userId, subs, payload, 'reminder')
        sent += delivered
        if (delivered > 0) {
          await supabase
            .from('reminders')
            .update({ nudged_at: new Date().toISOString() })
            .in('id', items.map((r) => r.id))
        }
      }
    }

    // pre-reflection heads-up: one push per user per day at 21:30 local, so
    // the day is fully logged before the 22:00 reflection reads it
    {
      const allSubs = await selectAll<PushSub & { user_id: string }>(() =>
        supabase.from('push_subscriptions').select('user_id, endpoint, p256dh, auth').order('endpoint'),
      )
      const subsByUser = new Map<string, PushSub[]>()
      for (const s of allSubs) {
        const list = subsByUser.get(s.user_id) ?? []
        list.push(s)
        subsByUser.set(s.user_id, list)
      }
      for (const [userId, subs] of subsByUser) {
        const { date, minutes } = nowFor(userId)
        if (minutes < REFLECT_PUSH_MIN || minutes >= REFLECT_PUSH_MIN + WINDOW_MIN) continue
        // dedupe: first insert wins, a second run the same day gets a conflict
        const { error: dupe } = await supabase.from('reflect_nudges_sent').insert({ user_id: userId, date })
        if (dupe) continue
        const payload = JSON.stringify({
          title: 'Routine Tracker',
          body: strFor(userId).reflectHeadsUp,
          tag: 'reflect-nudge', // replaces, never stacks
        })
        sent += await pushToUser(supabase, userId, subs, payload, 'reflect')
      }
    }

    return json({ sent })
  } catch (err) {
    console.error('send-nudges error:', err)
    return json({ error: 'internal error' }, 500)
  }
})
