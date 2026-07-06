-- Explore chart: date strength sets by the day the workout was actually done
-- (planned_sessions.date) instead of planned_sets.logged_at. logged_at is
-- rewritten to "now" whenever a past set is edited, so re-saving old sessions
-- made them pile onto today. The session's own date is stable across edits and
-- is user-editable, so it's the honest "which day" for day/week/month buckets.
-- The hourly (last-24h) view still uses logged_at, matching tasks and cardio,
-- since a session date carries no time of day. Signature is unchanged, so the
-- frontend rpc('explore_buckets', ...) call keeps working as-is.
create or replace function explore_buckets(metric text, bucket text, start_ts timestamp)
returns table(b timestamp, v numeric)
language sql
stable
set search_path = public
as $$
  select date_trunc(bucket, x.d) as b, sum(x.v) as v
  from (
    select case when bucket = 'hour'
                then coalesce(l.logged_at::timestamp, l.date::timestamp)
                else l.date::timestamp end as d,
           1::numeric as v
      from task_logs l
      where metric = 'tasks' and l.status in ('done', 'partial')
        and (case when bucket = 'hour'
                  then coalesce(l.logged_at::timestamp, l.date::timestamp)
                  else l.date::timestamp end) >= start_ts
    union all
    select case when bucket = 'hour'
                then ps.logged_at::timestamp
                else coalesce(sess.date::timestamp, ps.logged_at::timestamp) end,
           1
      from planned_sets ps
      join planned_sessions sess on sess.id = ps.session_id
      where metric = 'sets' and ps.logged_reps is not null
        and (case when bucket = 'hour'
                  then ps.logged_at::timestamp
                  else coalesce(sess.date::timestamp, ps.logged_at::timestamp) end) >= start_ts
    union all
    select case when bucket = 'hour' then c.created_at::timestamp else c.date::timestamp end,
           coalesce(c.distance_km, 0)
      from cardio_logs c
      where metric = 'cardio'
        and (case when bucket = 'hour' then c.created_at::timestamp else c.date::timestamp end) >= start_ts
  ) x
  group by 1
  order by 1
$$;
