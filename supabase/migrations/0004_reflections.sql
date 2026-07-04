-- AI weekly reflection: two gentle sentences per week, written by the
-- weekly-reflection Edge Function (pg_cron, Sunday evening).
create table reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users,
  week_start date not null, -- Monday of the reflected week
  body text not null,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

alter table reflections enable row level security;

create policy "own reflections" on reflections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
