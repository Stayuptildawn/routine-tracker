-- Training blocks: instantiates workout_plans into loggable sessions & sets.
-- user_id is denormalized onto every table so RLS stays simple and the
-- service-role interpret core can scope directly.

create table training_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  name text not null,
  block int not null default 1,
  start_date date not null,
  total_weeks int not null default 6,
  notes text,
  created_at timestamptz default now()
);

create table planned_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  block_id uuid not null references training_blocks on delete cascade,
  week_number int not null,
  day_number int not null,
  split_day text not null,
  cardio text,
  date date,                -- stamped when the session is started
  completed_at timestamptz
);

create table planned_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  session_id uuid not null references planned_sessions on delete cascade,
  sort_order int not null,
  exercise text not null,
  muscle_group text,
  set_number int not null,
  target_scheme text,
  target_weight numeric,
  logged_weight numeric,
  logged_reps int,
  logged_at timestamptz     -- null = not logged yet
);

create table recovery_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users,
  session_id uuid not null references planned_sessions on delete cascade,
  muscle_group text not null,
  recovery text check (recovery in ('fresh','ready_days_ago','just_in_time','still_worn')),
  effort text check (effort in ('barely','solid','everything')),
  amount text check (amount in ('could_take_more','right','stretch','over_the_line')),
  created_at timestamptz default now()
);

alter table training_blocks enable row level security;
alter table planned_sessions enable row level security;
alter table planned_sets enable row level security;
alter table recovery_checkins enable row level security;

create policy "own training_blocks" on training_blocks for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own planned_sessions" on planned_sessions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own planned_sets" on planned_sets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own recovery_checkins" on recovery_checkins for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create index planned_sets_session_idx on planned_sets (session_id, sort_order);
create index planned_sessions_block_idx on planned_sessions (block_id, week_number, day_number);

-- live updates: a set logged via Telegram appears in an open Session screen
alter publication supabase_realtime add table planned_sessions, planned_sets;

-- muscle groups for the seeded Block 1 exercises (the sheet has no column)
alter table workout_plans add column muscle_group text;

update workout_plans set muscle_group = m.mg
from (values
  ('Flat DB Bench Press', 'Chest'),
  ('Incline DB Bench Press', 'Chest'),
  ('Pec Deck Fly', 'Chest'),
  ('Weighted Dip', 'Chest'),
  ('Seated DB OHP', 'Shoulders'),
  ('Cable Lateral Raise', 'Shoulders'),
  ('Face Pull', 'Shoulders'),
  ('Reverse Fly Machine', 'Shoulders'),
  ('Cable Tricep Pushdown', 'Triceps'),
  ('Overhead Cable Extension', 'Triceps'),
  ('Weighted Lat Pulldown', 'Back'),
  ('Chest-Supported DB Row', 'Back'),
  ('Close-Grip Pulldown', 'Back'),
  ('Seated Cable Row', 'Back'),
  ('DB Hammer Curl', 'Biceps'),
  ('Incline DB Curl', 'Biceps'),
  ('Leg Press', 'Quads'),
  ('Hack Squat Machine', 'Quads'),
  ('Leg Extension', 'Quads'),
  ('Bulgarian Split Squat', 'Quads'),
  ('Lying Leg Curl', 'Hamstrings'),
  ('Hip Thrust', 'Glutes'),
  ('Cable Pull-Through', 'Glutes'),
  ('Seated Calf Raise', 'Calves')
) as m(exercise, mg)
where workout_plans.exercise = m.exercise;
