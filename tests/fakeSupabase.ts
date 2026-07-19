// A tiny in-memory stand-in for the Supabase client, implementing exactly
// the slice of the query API that interpret.ts uses. Rows live in plain
// arrays per table; nested selects (routines with tasks) work by simply
// storing the nested array on the row. Filters/order/limit are applied when
// the builder is awaited, mirroring the real client's thenable behavior.

type Row = Record<string, any>

export class FakeDb {
  tables = new Map<string, Row[]>()

  seed(table: string, rows: Row[]) {
    this.tables.set(
      table,
      rows.map((r) => ({ id: crypto.randomUUID(), ...r })),
    )
  }

  rows(table: string): Row[] {
    if (!this.tables.has(table)) this.tables.set(table, [])
    return this.tables.get(table)!
  }

  client() {
    return { from: (table: string) => new FakeQuery(this, table) }
  }
}

class FakeQuery {
  private op: 'select' | 'insert' | 'update' | 'upsert' = 'select'
  private filters: ((r: Row) => boolean)[] = []
  private orders: { col: string; ascending: boolean }[] = []
  private limitN: number | null = null
  private values: Row | Row[] | null = null
  private conflictCols: string[] = []
  private countMode = false
  private single_: 'single' | 'maybe' | null = null

  constructor(
    private db: FakeDb,
    private table: string,
  ) {}

  select(_cols = '*', opts?: { count?: string; head?: boolean }) {
    if (opts?.count) this.countMode = true
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
  upsert(values: Row, opts?: { onConflict?: string }) {
    this.op = 'upsert'
    this.values = values
    this.conflictCols = opts?.onConflict?.split(',').map((s) => s.trim()) ?? []
    return this
  }
  eq(col: string, val: unknown) {
    this.filters.push((r) => r[col] === val)
    return this
  }
  in(col: string, vals: unknown[]) {
    this.filters.push((r) => vals.includes(r[col]))
    return this
  }
  is(col: string, val: unknown) {
    this.filters.push((r) => (val === null ? r[col] == null : r[col] === val))
    return this
  }
  gte(col: string, val: any) {
    this.filters.push((r) => r[col] >= val)
    return this
  }
  ilike(col: string, pattern: string) {
    const needle = pattern.replace(/%/g, '').toLowerCase()
    this.filters.push((r) => String(r[col] ?? '').toLowerCase().includes(needle))
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, ascending: opts?.ascending ?? true })
    return this
  }
  limit(n: number) {
    this.limitN = n
    return this
  }
  single() {
    this.single_ = 'single'
    return this
  }
  maybeSingle() {
    this.single_ = 'maybe'
    return this
  }

  private matching(): Row[] {
    let rows = this.db.rows(this.table).filter((r) => this.filters.every((f) => f(r)))
    for (const o of [...this.orders].reverse()) {
      rows = [...rows].sort((a, b) => {
        const x = a[o.col]
        const y = b[o.col]
        const c = x === y ? 0 : x < y ? -1 : 1
        return o.ascending ? c : -c
      })
    }
    if (this.limitN != null) rows = rows.slice(0, this.limitN)
    return rows
  }

  private run(): { data: any; error: null; count: number | null } {
    if (this.op === 'insert') {
      const list = (Array.isArray(this.values) ? this.values : [this.values]) as Row[]
      const inserted = list.map((v) => ({ id: crypto.randomUUID(), ...v }))
      this.db.rows(this.table).push(...inserted)
      const data = this.single_ ? inserted[0] : inserted
      return { data, error: null, count: null }
    }
    if (this.op === 'upsert') {
      const v = this.values as Row
      const existing = this.db
        .rows(this.table)
        .find((r) => this.conflictCols.length > 0 && this.conflictCols.every((c) => r[c] === v[c]))
      let row: Row
      if (existing) {
        Object.assign(existing, v)
        row = existing
      } else {
        row = { id: crypto.randomUUID(), ...v }
        this.db.rows(this.table).push(row)
      }
      return { data: this.single_ ? row : [row], error: null, count: null }
    }
    if (this.op === 'update') {
      const rows = this.matching()
      for (const r of rows) Object.assign(r, this.values)
      return { data: null, error: null, count: null }
    }
    // reads hand back detached copies, like the real client - a row fetched
    // before a later update must not see that update through aliasing
    const rows = this.matching().map((r) => ({ ...r }))
    if (this.countMode) return { data: null, error: null, count: rows.length }
    if (this.single_) return { data: rows[0] ?? null, error: null, count: null }
    return { data: rows, error: null, count: null }
  }

  then(resolve: (v: any) => void, reject?: (e: unknown) => void) {
    try {
      resolve(this.run())
    } catch (err) {
      if (reject) reject(err)
      else throw err
    }
  }
}
