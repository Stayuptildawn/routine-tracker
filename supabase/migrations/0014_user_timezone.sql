-- Per-user timezone (IANA name), set from the in-app Settings screen.
-- Server-side features (nudges, weekly reflection, Telegram day-stamping)
-- read it per user, falling back to the USER_TIMEZONE secret, then UTC.
alter table user_settings add column timezone text;
