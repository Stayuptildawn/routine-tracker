-- Explore rework: Daily = last 24 hours, hourly. Task logs gain a real
-- timestamp (older rows stay date-only and land on midnight in hour view).
-- explore_buckets learns the 'hour' bucket and takes a timestamp start.
alter table task_logs add column logged_at timestamptz;

drop function if exists explore_buckets(text, text, date);

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
    select ps.logged_at::timestamp, 1
      from planned_sets ps
      where metric = 'sets' and ps.logged_reps is not null and ps.logged_at::timestamp >= start_ts
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
