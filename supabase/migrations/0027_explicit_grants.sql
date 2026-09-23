-- Explicit Data API grants for every table in public.
--
-- From 2026-10-30 Supabase stops auto-granting new public tables to the API
-- roles, so a replay of these migrations (new project, preview branch,
-- `supabase db reset`) would leave every table unreachable. The live project
-- already has these grants; this migration makes the migrations say so.
--
-- anon is deliberately left out: every table is per-user behind RLS and the
-- app only reads data after sign-in (demo mode runs on a fake client).
--
-- Any future migration that creates a table must end with the same two
-- grants for that table.

grant select, insert, update, delete on
  routines, tasks, task_logs, daily_state, workout_logs, reminders,
  ai_actions, telegram_links, reflections, push_subscriptions, nudges_sent,
  workout_plans, user_settings, training_blocks, planned_sessions,
  planned_sets, recovery_checkins, cardio_logs, reflect_nudges_sent,
  training_reviews, monthly_reflections
to authenticated, service_role;
