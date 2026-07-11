-- Reminders with a deadline can also carry a clock time ("call the bank at
-- 15:00"). When set, send-nudges pushes at that local time on the due date
-- instead of folding the reminder into the generic 09:00 due-today batch.
alter table reminders add column due_time time;
