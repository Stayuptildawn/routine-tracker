-- Optional average heart rate (bpm) per cardio entry.
alter table cardio_logs add column if not exists avg_hr int;
