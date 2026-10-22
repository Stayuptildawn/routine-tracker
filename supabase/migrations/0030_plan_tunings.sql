-- Plan tuning from the volume picture (lib/volumeTuning.ts): the Workout tab
-- suggests ±1 set on a plan exercise from the last four weeks of volume and
-- the recovery check-ins. Each row records one suggestion the user applied
-- or dismissed. It does two jobs:
--   - cooldown: only check-ins newer than a muscle's latest row count, so a
--     change is never suggested again off the answers that caused it
--   - history: the weekly coach reads recent applied rows, so its advice
--     knows the plan was just changed and doesn't contradict it

create table plan_tunings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  muscle_group text not null,
  exercise text not null,
  split_day text not null,
  block int not null,
  delta int not null check (delta in (-1, 1)),
  from_sets int not null,
  to_sets int not null,
  action text not null check (action in ('applied', 'dismissed')),
  created_at timestamptz default now()
);

create index plan_tunings_user_muscle_idx on plan_tunings (user_id, muscle_group, created_at desc);

alter table plan_tunings enable row level security;

create policy "own plan_tunings" on plan_tunings for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on plan_tunings to authenticated, service_role;
