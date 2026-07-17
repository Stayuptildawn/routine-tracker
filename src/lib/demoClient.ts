// A tiny in-browser stand-in for the Supabase client, used in demo mode.
// It implements exactly the query surface this app uses (see call sites):
// from().select/insert/update/upsert/delete with eq/neq/in/gte/is/not/order/
// limit/range/single/maybeSingle, auth, channels (no-op), functions.invoke
// (canned reply) and the explore_buckets rpc (computed locally). Data lives
// in localStorage under 'demo-db', seeded with a believable week of history.

import { localDate, isoWeekday } from './types'
import { exitDemo } from './demo'
import { t, lang } from '../i18n'

type Row = Record<string, unknown>
type Db = Record<string, Row[]>

const DB_KEY = 'demo-db'

// ---------- storage ----------

let db: Db | null = null

function loadDb(): Db {
  if (db) return db
  const raw = localStorage.getItem(DB_KEY)
  // demo data is language-specific seed content - switching language reseeds
  // (it's throwaway data, and mixed-language routines would look broken)
  if (raw && localStorage.getItem(DB_KEY + '-lang') === lang) {
    try {
      db = JSON.parse(raw) as Db
      return db
    } catch {
      /* corrupted - reseed */
    }
  }
  db = seed()
  localStorage.setItem(DB_KEY + '-lang', lang)
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

// ---------- seed ----------

function dateNDaysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return localDate(d)
}

function isoNDaysAgo(n: number, hour = 12): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(hour, 15, 0, 0)
  return d.toISOString()
}

function seed(): Db {
  const data: Db = {}
  const routines: Row[] = []
  const tasks: Row[] = []
  const taskLogs: Row[] = []

  t.seed.forEach((r, i) => {
    const routineId = crypto.randomUUID()
    routines.push({
      id: routineId,
      name: r.name,
      category: r.category,
      sort_order: i,
      anchor_time: r.name === t.seed[0].name ? '08:00:00' : null,
      active: r.active ?? true,
      created_at: isoNDaysAgo(30),
    })
    r.tasks.forEach((task, j) => {
      const taskId = crypto.randomUUID()
      tasks.push({
        id: taskId,
        routine_id: routineId,
        label: task.label,
        sort_order: j,
        tier: task.tier,
        scheduled_days: task.days ?? [1, 2, 3, 4, 5, 6, 7],
        created_at: isoNDaysAgo(30),
      })
      // a believable week: most core/standard tasks done on past days, the
      // odd conscious skip, today partially done (deterministic, not random)
      if (r.active === false) return
      for (let ago = 6; ago >= 0; ago--) {
        const day = new Date()
        day.setDate(day.getDate() - ago)
        const weekday = isoWeekday(day)
        const days = task.days ?? [1, 2, 3, 4, 5, 6, 7]
        if (!days.includes(weekday)) continue
        const mix = (i * 31 + j * 17 + ago * 7) % 10
        let status: string | null = null
        if (ago === 0) {
          // this morning: the first couple of tasks are already ticked
          if (j < 2 && i === 0) status = 'done'
        } else if (task.tier === 'bonus') {
          if (mix < 4) status = 'done'
        } else {
          if (mix < 7) status = 'done'
          else if (mix === 7) status = 'skipped'
        }
        if (status) {
          taskLogs.push({
            id: crypto.randomUUID(),
            task_id: taskId,
            date: dateNDaysAgo(ago),
            status,
            completed_via: 'manual',
            notes: null,
            logged_at: isoNDaysAgo(ago, 9 + ((j * 3) % 10)),
            created_at: isoNDaysAgo(ago, 9),
          })
        }
      }
    })
  })

  data.routines = routines
  data.tasks = tasks
  data.task_logs = taskLogs

  data.daily_state = [
    { id: crypto.randomUUID(), date: dateNDaysAgo(1), energy: 'medium', created_at: isoNDaysAgo(1, 8) },
  ]

  data.reminders = [
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.reminder1,
      ai_category: null,
      ai_confidence: null,
      final_category: t.seed[t.seed.length - 1].name, // Errands
      routine_id: routines[routines.length - 1].id,
      status: 'reassigned',
      due_date: dateNDaysAgo(0),
      due_time: '18:00:00',
      created_at: isoNDaysAgo(2),
      updated_at: isoNDaysAgo(2),
    },
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.reminder2,
      ai_category: 'Other',
      ai_confidence: 0.9,
      final_category: 'Other',
      routine_id: null,
      status: 'auto',
      due_date: dateNDaysAgo(-3),
      due_time: null,
      created_at: isoNDaysAgo(1),
      updated_at: isoNDaysAgo(1),
    },
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.reminder3,
      ai_category: null,
      ai_confidence: null,
      final_category: t.seed[t.seed.length - 2].name, // Paperwork
      routine_id: routines[routines.length - 2].id,
      status: 'reassigned',
      due_date: null,
      due_time: null,
      created_at: isoNDaysAgo(4),
      updated_at: isoNDaysAgo(4),
    },
  ]

  data.cardio_logs = [
    { kind: 'run', ago: 1, km: 6.2, min: 39, hr: 152, amount: 'right', effort: 'steady' },
    { kind: 'walk', ago: 2, km: 3.1, min: 42, hr: null, amount: null, effort: 'easy' },
    { kind: 'run', ago: 4, km: 5, min: 32, hr: 156, amount: 'right', effort: 'steady' },
    { kind: 'run', ago: 8, km: 5, min: 33.5, hr: 158, amount: 'stretch', effort: 'pushed' },
    { kind: 'walk', ago: 9, km: 2.5, min: 35, hr: null, amount: null, effort: null },
    { kind: 'run', ago: 11, km: 4.2, min: 28, hr: 154, amount: 'right', effort: 'steady' },
  ].map((c) => ({
    id: crypto.randomUUID(),
    session_id: null,
    date: dateNDaysAgo(c.ago),
    kind: c.kind,
    distance_km: c.km,
    minutes: c.min,
    avg_hr: c.hr,
    notes: null,
    effort: c.effort,
    body: null,
    amount: c.amount,
    created_at: isoNDaysAgo(c.ago, 18),
  }))

  data.workout_logs = [
    { ago: 2, ex: 'Flat DB Bench Press', sets: [{ kg: 26, reps: 10 }, { kg: 26, reps: 9 }, { kg: 24, reps: 10 }] },
    { ago: 2, ex: 'Seated Cable Row', sets: [{ kg: 55, reps: 12 }, { kg: 55, reps: 11 }] },
    { ago: 5, ex: 'Leg Press', sets: [{ kg: 120, reps: 10 }, { kg: 120, reps: 10 }, { kg: 130, reps: 8 }] },
  ].map((w) => ({
    id: crypto.randomUUID(),
    date: dateNDaysAgo(w.ago),
    week_number: null,
    split_day: null,
    exercise: w.ex,
    target_scheme: null,
    sets: w.sets,
    notes: null,
    created_at: isoNDaysAgo(w.ago, 19),
  }))

  const monday = new Date()
  monday.setDate(monday.getDate() - (isoWeekday() - 1))
  data.reflections = [
    { id: crypto.randomUUID(), week_start: localDate(monday), body: t.demo.reflection, created_at: isoNDaysAgo(0, 8) },
  ]

  data.ai_actions = [
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.aiExample1Text,
      actions: [
        { type: 'check_task', label: t.seed[0].tasks[2].label, status: 'done' },
        { type: 'check_task', label: t.seed[0].tasks[3].label, status: 'done' },
      ],
      status: 'confirmed',
      created_at: isoNDaysAgo(1, 9),
    },
    {
      id: crypto.randomUUID(),
      raw_text: t.demo.aiExample2Text,
      actions: [
        { type: 'log_cardio', kind: 'run', distance_km: 5, minutes: 32 },
      ],
      status: 'applied',
      created_at: isoNDaysAgo(4, 18),
    },
  ]

  data.workout_plans = []
  data.training_blocks = []
  data.planned_sessions = []
  data.planned_sets = []
  data.recovery_checkins = []
  data.user_settings = []
  data.push_subscriptions = []

  return data
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
      return { data: null, error: null, count: null }
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
  // iso: full timestamp or yyyy-mm-dd; returns the bucket key Reflect expects
  const date = iso.slice(0, 10)
  if (bucket === 'hour') return iso.length > 10 ? iso.slice(0, 13) : date + 'T12'
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
    async invoke(name: string) {
      if (name === 'interpret-message') {
        return {
          data: { ai_action_id: null, applied: [], suggestions: [], answers: [t.demo.aiUnavailable] },
          error: null,
        }
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
