// A tiny in-browser stand-in for the Supabase client, used in demo mode.
// It implements exactly the query surface this app uses (see call sites):
// from().select/insert/update/upsert/delete with eq/neq/in/gte/is/not/order/
// limit/range/single/maybeSingle, auth, channels (no-op), functions.invoke
// (canned reply) and the explore_buckets rpc (computed locally). Data lives
// in localStorage under 'demo-db', seeded with two believable months of
// history (see demoSeed.ts).

import { localDate, isoWeekday } from './types'
import { exitDemo } from './demo'
import { t, lang } from '../i18n'
import { parseDueDate } from '../../supabase/functions/_shared/timeparse'
import { seed, isoNDaysAgo } from './demoSeed'
import type { Row, Db } from './demoSeed'

const DB_KEY = 'demo-db'
// bump when seed() gains content - returning visitors reseed and see it
const SEED_VERSION = '3'

// ---------- storage ----------

let db: Db | null = null

function loadDb(): Db {
  if (db) return db
  const raw = localStorage.getItem(DB_KEY)
  // demo data is language-specific seed content - switching language reseeds
  // (it's throwaway data, and mixed-language routines would look broken)
  if (raw && localStorage.getItem(DB_KEY + '-lang') === lang && localStorage.getItem(DB_KEY + '-v') === SEED_VERSION) {
    try {
      db = JSON.parse(raw) as Db
      return db
    } catch {
      /* corrupted - reseed */
    }
  }
  db = seed()
  localStorage.setItem(DB_KEY + '-lang', lang)
  localStorage.setItem(DB_KEY + '-v', SEED_VERSION)
  saveDb()
  return db
}

function saveDb() {
  if (db) localStorage.setItem(DB_KEY, JSON.stringify(db))
}

function rowsFor(table: string): Row[] {
  const data = loadDb()
  return (data[table] ??= [])
}

// ---------- query builder ----------

type Filter = (row: Row) => boolean

interface OrderSpec {
  col: string
  ascending: boolean
}

function cmp(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0
  if (a == null) return 1 // nulls last
  if (b == null) return -1
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
}

// Column defaults the real database fills in on insert. Without them a row
// made in the demo (a new task, routine or reminder) lacks fields the screens
// read without checking, and the app would crash on the next render.
const INSERT_DEFAULTS: Record<string, () => Row> = {
  tasks: () => ({ scheduled_days: [1, 2, 3, 4, 5, 6, 7], tier: 'standard' }),
  routines: () => ({ active: true, category: null, anchor_time: null }),
  reminders: () => ({ updated_at: new Date().toISOString() }),
}

class DemoQuery {
  private table: string
  private op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private filters: Filter[] = []
  private orders: OrderSpec[] = []
  private limitN: number | null = null
  private rangeSpec: [number, number] | null = null
  private values: Row | Row[] | null = null
  private onConflict: string[] | null = null
  private countMode = false
  private headMode = false
  private wantSingle: 'single' | 'maybe' | null = null
  private selectCols = '*'

  constructor(table: string) {
    this.table = table
  }

  select(cols = '*', opts?: { count?: string; head?: boolean }) {
    this.selectCols = cols
    if (opts?.count) this.countMode = true
    if (opts?.head) this.headMode = true
    return this
  }
  insert(values: Row | Row[]) {
    this.op = 'insert'
    this.values = values
    return this
  }
  update(values: Row) {
    this.op = 'update'
    this.values = values
    return this
  }
  upsert(values: Row | Row[], opts?: { onConflict?: string }) {
    this.op = 'upsert'
    this.values = values
    this.onConflict = opts?.onConflict ? opts.onConflict.split(',').map((s) => s.trim()) : null
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }

  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }
  neq(col: string, val: unknown) {
    this.filters.push((r) => r[col] !== val)
    return this
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]))
    return this
  }
  gte(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], val) >= 0)
    return this
  }
  lte(col: string, val: unknown) {
    this.filters.push((r) => r[col] != null && cmp(r[col], val) <= 0)
    return this
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val))
    return this
  }
  not(col: string, operator: string, val: unknown) {
    if (operator === 'is' && val === null) this.filters.push((r) => r[col] != null)
    else this.filters.push((r) => r[col] !== val)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending !== false })
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  range(from: number, to: number) {
    this.rangeSpec = [from, to]
    return this
  }
  single() {
    this.wantSingle = 'single'
    return this
  }
  maybeSingle() {
    this.wantSingle = 'maybe'
    return this
  }
  abortSignal(_signal: AbortSignal) {
    return this // nothing to time out - the fake DB answers instantly
  }

  private matching(rows: Row[]): Row[] {
    return rows.filter((r) => this.filters.every((f) => f(r)))
  }

  private embed(rows: Row[]): Row[] {
    // the two nested selects this app uses, resolved by hand
    if (this.table === 'routines' && this.selectCols.includes('tasks(')) {
      const allTasks = rowsFor('tasks')
      return rows.map((r) => ({ ...r, tasks: allTasks.filter((task) => task.routine_id === r.id) }))
    }
    if (this.table === 'task_logs' && this.selectCols.includes('tasks(')) {
      const allTasks = rowsFor('tasks')
      const allRoutines = rowsFor('routines')
      return rows.map((r) => {
        const task = allTasks.find((x) => x.id === r.task_id) ?? null
        const routine = task ? allRoutines.find((x) => x.id === task.routine_id) ?? null : null
        return { ...r, tasks: task ? { ...task, routines: routine ? { name: routine.name } : null } : null }
      })
    }
    return rows
  }

  private run(): { data: unknown; error: null | { message: string }; count: number | null } {
    const rows = rowsFor(this.table)

    if (this.op === 'insert' || this.op === 'upsert') {
      const list = (Array.isArray(this.values) ? this.values : [this.values ?? {}]).map((v) => ({ ...v }))
      const inserted: Row[] = []
      for (const v of list) {
        let target: Row | undefined
        if (this.op === 'upsert') {
          const cols = (this.onConflict ?? ['id']).filter((c) => v[c] !== undefined)
          target =
            cols.length > 0
              ? rows.find((r) => cols.every((c) => r[c] === v[c]))
              : rows[0] // singleton per-user table (user_settings)
        }
        if (target) {
          Object.assign(target, v)
          inserted.push(target)
        } else {
          const row: Row = {
            id: crypto.randomUUID(),
            created_at: new Date().toISOString(),
            ...INSERT_DEFAULTS[this.table]?.(),
            ...v,
          }
          rows.push(row)
          inserted.push(row)
        }
      }
      saveDb()
      const data = this.wantSingle ? inserted[0] ?? null : inserted
      return { data: JSON.parse(JSON.stringify(data)), error: null, count: null }
    }

    if (this.op === 'update') {
      const targets = this.matching(rows)
      for (const r of targets) Object.assign(r, this.values)
      saveDb()
      // like .update().select(): the rows it touched (callers use it to
      // tell "updated" from "matched nothing")
      return { data: JSON.parse(JSON.stringify(targets)), error: null, count: null }
    }

    if (this.op === 'delete') {
      const keep = rows.filter((r) => !this.filters.every((f) => f(r)))
      loadDb()[this.table] = keep
      saveDb()
      return { data: null, error: null, count: null }
    }

    // select
    let out = this.matching(rows)
    if (this.countMode) {
      return { data: this.headMode ? null : out, error: null, count: out.length }
    }
    if (this.orders.length > 0) {
      out = [...out].sort((a, b) => {
        for (const o of this.orders) {
          const c = cmp(a[o.col], b[o.col])
          if (c !== 0) return o.ascending ? c : -c
        }
        return 0
      })
    }
    if (this.rangeSpec) out = out.slice(this.rangeSpec[0], this.rangeSpec[1] + 1)
    if (this.limitN != null) out = out.slice(0, this.limitN)
    out = this.embed(out)
    const copy = JSON.parse(JSON.stringify(out)) as Row[]
    if (this.wantSingle) {
      return {
        data: copy[0] ?? null,
        error: this.wantSingle === 'single' && copy.length === 0 ? { message: 'no rows' } : null,
        count: null,
      }
    }
    return { data: copy, error: null, count: null }
  }

  // thenable, so `await` and `.then()` both work like the real client
  then<T>(resolve: (v: { data: unknown; error: null | { message: string }; count: number | null }) => T) {
    return Promise.resolve(this.run()).then(resolve)
  }
}

// ---------- rpc: explore_buckets, computed from the local tables ----------

function truncate(iso: string, bucket: string): string {
  // iso: full timestamp or yyyy-mm-dd; returns the bucket key Reflect expects:
  // hours in UTC, days in the visitor's own calendar (an evening log must not
  // slide into the next day west of Greenwich)
  if (bucket === 'hour') return iso.length > 10 ? iso.slice(0, 13) : iso + 'T12'
  const date = iso.length > 10 ? localDate(new Date(iso)) : iso
  if (bucket === 'day') return date
  if (bucket === 'week') {
    const d = new Date(date + 'T00:00:00')
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return localDate(d)
  }
  return date.slice(0, 8) + '01' // month
}

function exploreBuckets(args: { metric: string; bucket: string; start_ts: string }) {
  const start = args.start_ts.slice(0, 10)
  const acc = new Map<string, number>()
  const add = (key: string, v: number) => acc.set(key, (acc.get(key) ?? 0) + v)
  if (args.metric === 'tasks') {
    for (const l of rowsFor('task_logs')) {
      if (l.status !== 'done' && l.status !== 'partial') continue
      if (String(l.date) < start) continue
      add(truncate(String(l.logged_at ?? l.date), args.bucket), 1)
    }
  } else if (args.metric === 'sets') {
    for (const s of rowsFor('planned_sets')) {
      if (s.logged_reps == null || !s.logged_at) continue
      if (String(s.logged_at).slice(0, 10) < start) continue
      add(truncate(String(s.logged_at), args.bucket), 1)
    }
    for (const w of rowsFor('workout_logs')) {
      if (String(w.date) < start) continue
      add(truncate(String(w.date), args.bucket), (w.sets as unknown[] | null)?.length ?? 0)
    }
  } else if (args.metric === 'cardio') {
    for (const c of rowsFor('cardio_logs')) {
      if (String(c.date) < start) continue
      add(truncate(String(c.date), args.bucket), Number(c.distance_km ?? 0))
    }
  }
  return [...acc.entries()].map(([b, v]) => ({ b, v }))
}

// ---------- demo composer: a tiny deterministic stand-in for the AI ----------
// The real parser needs a server; the demo gets regexes that cover the
// README's example phrasings - check-offs by task name (works in every
// language, it matches the seeded labels), "bench 60kg 3x8", "ran 5k in
// 25 min at 152 bpm" and "remind me to ...". Real rows are written and a
// real undo batch is recorded, so the whole apply/undo/AI-log loop is
// demonstrable offline. Anything it can't place falls back to the explainer.

const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'out', 'off', 'one', 'had', 'has', 'did', 'got', 'get', 'was', 'not', 'you', 'your', 'min', 'time'])
const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
// scripts written without spaces: a label is one unbroken run, so it is looked
// for inside the message instead of word by word
const UNSPACED = /[぀-ヿ㐀-鿿]/
/** `word` is `base` as it stands or with a plain ending: "dishes", "stretched"
 *  - but "breakfast" is no form of "break", nor "ready" of "read". */
const formOf = (word: string, base: string) =>
  word === base || (base.length >= 4 && word.startsWith(base) && /^(s|es|d|ed|ing)$/.test(word.slice(base.length)))

/** Which of today's task labels a message mentions. A label is recognised by
 *  a word that belongs to it alone ("breakfast", not the "eat" two labels
 *  share), said whole - so "bought bread" never ticks "Read 10 pages". */
function labelMatcher(labels: string[], message: string): (label: string) => boolean {
  const perLabel = labels.map(words)
  const spoken = words(message)
  return (label) =>
    words(label).some((w) => {
      if (STOP_WORDS.has(w) || /^\d+$/.test(w)) return false
      // a word another label carries too says nothing about which one is meant
      if (perLabel.filter((other) => other.some((x) => formOf(x, w) || formOf(w, x))).length > 1) return false
      if (UNSPACED.test(w)) return w.length >= 2 && message.includes(w)
      if (w.length < 3) return false
      return spoken.some((word) => formOf(word, w))
    })
}

function demoInterpret(text: string): {
  ai_action_id: string | null
  applied: Row[]
  suggestions: Row[]
  answers: string[]
} {
  const today = localDate()
  const nowIso = new Date().toISOString()
  const applied: Row[] = []
  const lower = text.toLowerCase()
  const num = (s: string) => parseFloat(s.replace(',', '.'))

  const reminderM = text.match(/remind me to\s+(.+)/i)
  const setsM = text.match(/(.+?)\s+(\d+(?:[.,]\d+)?)\s*(?:kg)?\s+(\d{1,2})\s*[x×]\s*(\d{1,2})\b/i)
  const cardioKind = /\b(ran|run|jog\w*)\b/.test(lower)
    ? 'run'
    : /\bwalk\w*\b/.test(lower)
      ? 'walk'
      : /\b(cycle\w*|biked?)\b/.test(lower)
        ? 'cycle'
        : /\b(swam|swim)\b/.test(lower)
          ? 'swim'
          : null

  if (reminderM) {
    // one reminder, with the same light time handling the real parser has
    let dueDate: string | null = null
    let dueTime: string | null = null
    const rel = lower.match(/in\s+(\d+)\s*min/)
    const abs = lower.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/)
    if (rel) {
      const d = new Date(Date.now() + parseInt(rel[1], 10) * 60000)
      dueTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      dueDate = localDate(d)
    } else if (abs) {
      let h = parseInt(abs[1], 10)
      if (abs[3] === 'pm' && h < 12) h += 12
      if (abs[3] === 'am' && h === 12) h = 0
      dueTime = `${String(h).padStart(2, '0')}:${abs[2] ?? '00'}`
    }
    // the day comes from the same parser the real function falls back on
    if (!dueDate) dueDate = parseDueDate(lower, today) ?? (dueTime ? today : null)
    const raw = reminderM[1]
      .replace(/\s+(in\s+\d+\s*min\w*|at\s+\d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow|tmrw|today|tonight|(on|by|next)\s+\w+day)\b/gi, '')
      .trim()
    const row: Row = {
      id: crypto.randomUUID(),
      user_id: DEMO_USER.id,
      raw_text: raw.charAt(0).toUpperCase() + raw.slice(1),
      ai_category: 'Other',
      final_category: 'Other',
      ai_confidence: 0.95,
      routine_id: null,
      status: 'auto',
      due_date: dueDate,
      due_time: dueTime,
      created_at: nowIso,
      updated_at: nowIso,
    }
    rowsFor('reminders').push(row)
    applied.push({ type: 'create_reminder', reminder_id: row.id, text: row.raw_text, category: 'Other', due_date: dueDate, due_time: dueTime })
  } else if (setsM && !/\b(km|bpm)\b/.test(lower)) {
    const [, exercise, kg, nSets, reps] = setsM
    const sets = Array.from({ length: parseInt(nSets, 10) }, () => ({ kg: num(kg), reps: parseInt(reps, 10) }))
    const row: Row = {
      id: crypto.randomUUID(),
      user_id: DEMO_USER.id,
      date: today,
      exercise: exercise.trim(),
      sets,
      notes: null,
      week_number: null,
      split_day: null,
      target_scheme: null,
      muscle_group: null,
      created_at: nowIso,
    }
    rowsFor('workout_logs').push(row)
    applied.push({ type: 'log_workout', workout_log_id: row.id, exercise: row.exercise, sets })
  } else if (cardioKind) {
    const dist = lower.match(/(\d+(?:[.,]\d+)?)\s*(?:km|k\b)/)
    const mins = lower.match(/(\d+(?:[.,]\d+)?)\s*min/)
    const bpm = lower.match(/(\d{2,3})\s*bpm/)
    if (dist || mins) {
      const row: Row = {
        id: crypto.randomUUID(),
        user_id: DEMO_USER.id,
        date: today,
        kind: cardioKind,
        minutes: mins ? num(mins[1]) : null,
        distance_km: dist ? num(dist[1]) : null,
        avg_hr: bpm ? parseInt(bpm[1], 10) : null,
        notes: null,
        effort: null,
        body: null,
        amount: null,
        created_at: nowIso,
      }
      rowsFor('cardio_logs').push(row)
      applied.push({ type: 'log_cardio', cardio_log_id: row.id, kind: cardioKind, minutes: row.minutes, distance_km: row.distance_km, avg_hr: row.avg_hr })
    }
  }

  if (applied.length === 0) {
    // task check-off by label: any seeded task whose label-words show up
    const weekday = isoWeekday()
    const activeRoutines = new Set(rowsFor('routines').filter((r) => r.active !== false).map((r) => r.id))
    const todays = rowsFor('tasks').filter(
      (task) => activeRoutines.has(task.routine_id) && (task.scheduled_days as number[] | null)?.includes(weekday),
    )
    const said = labelMatcher(todays.map((task) => String(task.label)), lower)
    for (const task of todays) {
      if (!said(String(task.label))) continue
      const logs = rowsFor('task_logs')
      let log = logs.find((l) => l.task_id === task.id && l.date === today)
      if (log) {
        log.status = 'done'
        log.completed_via = 'ai_text'
        log.logged_at = nowIso
      } else {
        log = { id: crypto.randomUUID(), task_id: task.id, date: today, status: 'done', completed_via: 'ai_text', notes: null, logged_at: nowIso, created_at: nowIso }
        logs.push(log)
      }
      applied.push({ type: 'check_task', task_id: task.id, label: task.label, status: 'done', log_id: log.id, log_date: today })
    }
  }

  // a question gets the "answers from your own data" explainer; anything
  // else it couldn't place gets the general one. Both land in the AI log the
  // way real answers do, so the popup's "saved in the log" is true here too
  const isQuestion = /[?？؟]\s*$/.test(text.trim())
  const answers = applied.length > 0 ? [] : [isQuestion ? t.demo.askUnavailable : t.demo.aiUnavailable]
  let aiActionId: string | null = null
  if (applied.length > 0 || answers.length > 0) {
    const batch: Row = {
      id: crypto.randomUUID(),
      user_id: DEMO_USER.id,
      raw_text: text,
      actions: [...applied, ...answers.map((a) => ({ type: 'answer', text: a }))],
      status: applied.length > 0 ? 'applied' : 'answered',
      created_at: nowIso,
    }
    rowsFor('ai_actions').push(batch)
    if (applied.length > 0) aiActionId = batch.id as string
    saveDb()
  }
  return {
    ai_action_id: aiActionId,
    applied,
    suggestions: [],
    answers,
  }
}

// ---------- the client ----------

const DEMO_USER = {
  id: 'demo-user',
  email: t.demo.email,
  created_at: isoNDaysAgo(90),
}

const demoSession = {
  user: DEMO_USER,
  access_token: 'demo',
  refresh_token: 'demo',
  expires_in: 3600,
  token_type: 'bearer',
}

export const demoClient = {
  from(table: string) {
    return new DemoQuery(table)
  },

  auth: {
    async getSession() {
      return { data: { session: demoSession }, error: null }
    },
    async getUser() {
      return { data: { user: DEMO_USER }, error: null }
    },
    onAuthStateChange() {
      return { data: { subscription: { unsubscribe() {} } } }
    },
    async signOut() {
      exitDemo()
      return { error: null }
    },
    async updateUser() {
      return { data: { user: DEMO_USER }, error: null }
    },
    async signInWithPassword() {
      return { data: {}, error: { message: t.demo.noAccounts } }
    },
    async signUp() {
      return { data: {}, error: { message: t.demo.noAccounts } }
    },
    async resetPasswordForEmail() {
      return { data: {}, error: null }
    },
  },

  channel() {
    const ch = {
      on() {
        return ch
      },
      subscribe() {
        return ch
      },
    }
    return ch
  },
  removeChannel() {},

  functions: {
    async invoke(name: string, opts?: { body?: { text?: string } }) {
      if (name === 'interpret-message') {
        return { data: demoInterpret(opts?.body?.text ?? ''), error: null }
      }
      return { data: { error: t.demo.aiUnavailable }, error: null }
    },
  },

  async rpc(name: string, args: Record<string, unknown>) {
    if (name === 'explore_buckets') {
      return { data: exploreBuckets(args as { metric: string; bucket: string; start_ts: string }), error: null }
    }
    return { data: [], error: null }
  },
}
