-- Reminders gain an optional follow-up date ("email the lawyer by Friday").
-- Overdue reminders float to the top of the Reminders screen (amber, never red).
alter table reminders add column due_date date;
