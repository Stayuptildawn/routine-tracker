-- Monthly reflections: one summary per user per month, written by the
-- reflection cron in the first days of the next month. Twelve months are
-- kept; the month's weekly reflections and training reviews are pruned once
-- they are folded into a monthly row (the cron handles both).

create table monthly_reflections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  month_start date not null,
  body text not null,
  created_at timestamptz default now(),
  unique (user_id, month_start)
);

alter table monthly_reflections enable row level security;

create policy "own monthly_reflections" on monthly_reflections for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
