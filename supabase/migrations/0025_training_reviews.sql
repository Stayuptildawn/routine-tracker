-- Weekly AI training review, written once per user per week by the
-- weekly-reflection function (self-healing: first cron pass of the week
-- that finds no row generates it). Two parts: body is the 12-week trend
-- read shown on Reflect, advice is the coming week's plan suggestions
-- shown on the Workout tab. Advisory only - the AI never edits the plan.
create table training_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  week_start date not null, -- Monday of the week the advice is FOR
  body text not null,
  advice text not null,
  created_at timestamptz default now(),
  unique (user_id, week_start)
);

alter table training_reviews enable row level security;

create policy "own training_reviews" on training_reviews for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
