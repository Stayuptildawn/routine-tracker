-- Data explorer: server-side bucketing so 3 years of history comes back as
-- a few dozen rows instead of thousands. SECURITY INVOKER (the default) so
-- RLS scopes everything to the caller.
-- multi-user insurance: per-user date scans stay indexed as tables grow
create index if not exists planned_sets_user_logged_idx on planned_sets (user_id, logged_at);

create or replace function explore_buckets(metric text, bucket text, start_date date)
returns table(b date, v numeric)
language sql
stable
set search_path = public
as $$
  select date_trunc(bucket, x.d)::date as b, sum(x.v) as v
  from (
    select l.date::timestamp as d, 1::numeric as v
      from task_logs l
      where metric = 'tasks' and l.status in ('done', 'partial') and l.date >= start_date
    union all
    select ps.logged_at::timestamp, 1
      from planned_sets ps
      where metric = 'sets' and ps.logged_reps is not null and ps.logged_at >= start_date
    union all
    select c.date::timestamp, coalesce(c.distance_km, 0)
      from cardio_logs c
      where metric = 'cardio' and c.date >= start_date
  ) x
  group by 1
  order by 1
$$;
