// Small helpers for the service-role cron functions.

/** PostgREST caps a response at 1000 rows; cross-user reads must page or
 *  whoever sorts past the cap silently drops out. `build` returns a fresh
 *  query ordered by a unique key. */
export async function selectAll<T>(
  build: () => { range: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }> },
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...(data ?? []))
    if ((data ?? []).length < pageSize) return rows
  }
}
