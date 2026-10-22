-- Per-user switch for in-app cardio logging (Settings). Off hides the cardio
-- tab, its Reflect chart and CSV, and tells the coach/reflection prompts that
-- cardio is tracked elsewhere (a watch) - so "none logged" is never read as
-- "did no cardio". Off deletes nothing; existing cardio_logs stay.
alter table user_settings add column cardio_tracking boolean not null default true;
