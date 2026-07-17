-- Per-user UI language (i18n pack id: en/fr/es/de/zh/ar/fa), set from the
-- in-app Settings screen. Server-side text follows it: the weekly reflection
-- is written in this language and push nudges use its string table. Changing
-- language never triggers generation - the next scheduled pass picks it up.
alter table user_settings add column language text;
