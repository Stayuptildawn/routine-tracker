-- AuDHD Routine Tracker: initial schema
-- Conventions: scheduled_days uses ISO weekday numbers 1=Mon .. 7=Sun.
-- 'skipped' is a deliberate, neutral state - distinct from 'pending' (not done).

create table routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  name text not null,
  category text,
  sort_order int,
  created_at timestamptz default now()
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null references routines on delete cascade,
  label text not null,
  sort_order int,
  scheduled_days smallint[] not null default '{1,2,3,4,5,6,7}',
  tier text not null default 'standard'
    check (tier in ('core','standard','bonus'))  -- core = minimum viable routine
);

create table task_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  date date not null,
  status text not null default 'pending'
    check (status in ('pending','done','partial','skipped')),
  completed_via text default 'manual'
    check (completed_via in ('manual','ai_text','voice')),
  notes text,
  unique (task_id, date)
);

-- daily energy check-in drives which task tiers are shown
create table daily_state (
  user_id uuid not null default auth.uid() references auth.users,
  date date not null,
  energy text check (energy in ('low','medium','high')),
  primary key (user_id, date)
);

create table workout_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  date date not null default current_date,
  week_number int,
  split_day text,
  exercise text not null,
  target_scheme text,
  sets jsonb,          -- [{"kg": 60, "reps": 8}, ...]
  notes text,
  created_at timestamptz default now()
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  raw_text text not null,
  ai_category text,
  ai_confidence float,
  final_category text,
  routine_id uuid references routines on delete set null,
  task_label text,
  status text default 'auto'
    check (status in ('auto','reassigned','dismissed','done')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- audit + one-tap undo for every AI-applied action batch;
-- doubles as the AI-accuracy dataset for prompt tuning
create table ai_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  raw_text text not null,
  actions jsonb not null,
  status text not null default 'applied'
    check (status in ('applied','confirmed','undone')),
  created_at timestamptz default now()
);

create index task_logs_date_idx on task_logs (date);
create index workout_logs_user_date_idx on workout_logs (user_id, date desc);
create index ai_actions_user_created_idx on ai_actions (user_id, created_at desc);

-- Row Level Security
alter table routines enable row level security;
alter table tasks enable row level security;
alter table task_logs enable row level security;
alter table daily_state enable row level security;
alter table workout_logs enable row level security;
alter table reminders enable row level security;
alter table ai_actions enable row level security;

create policy "own routines" on routines for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own tasks" on tasks for all
  using (exists (select 1 from routines r where r.id = routine_id and r.user_id = auth.uid()))
  with check (exists (select 1 from routines r where r.id = routine_id and r.user_id = auth.uid()));

create policy "own task_logs" on task_logs for all
  using (exists (select 1 from tasks t join routines r on r.id = t.routine_id
                 where t.id = task_id and r.user_id = auth.uid()))
  with check (exists (select 1 from tasks t join routines r on r.id = t.routine_id
                      where t.id = task_id and r.user_id = auth.uid()));

create policy "own daily_state" on daily_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own workout_logs" on workout_logs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own reminders" on reminders for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "own ai_actions" on ai_actions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Realtime
alter publication supabase_realtime add table task_logs, daily_state, workout_logs, reminders, ai_actions;
