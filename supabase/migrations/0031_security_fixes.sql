-- Security fixes from the 2026-11 audit.

-- 1. The Telegram bot was removed from the code in July, but its link table
--    stayed. No function reads it any more; drop it with its rows so no stale
--    chat -> account grant outlives the feature.
drop table if exists telegram_links;

-- 2. Push endpoints come straight from the client. Only the real browser
--    push services are allowed, so the nudge cron (service role) can never be
--    pointed at an arbitrary host. Hosts: Chrome/Edge-on-Android/Brave/Samsung
--    (FCM), Firefox (Mozilla autopush), Safari and iOS (Apple), Edge on
--    Windows (WNS).
alter table push_subscriptions add constraint push_subscriptions_endpoint_host check (
  endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/'
);

-- A person has a handful of browsers, not hundreds: cap rows per user so one
-- account can't inflate the cron's fan-out.
create or replace function push_subscriptions_cap() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select count(*) from push_subscriptions where user_id = new.user_id) >= 10 then
    raise exception 'too many push subscriptions for this account';
  end if;
  return new;
end $$;

create trigger push_subscriptions_cap before insert on push_subscriptions
  for each row execute function push_subscriptions_cap();

revoke all on function push_subscriptions_cap() from public, anon, authenticated;

-- 3. Per-user daily budget for the operator-paid AI calls (interpret-message,
--    refresh-coach). The edge functions claim one call before talking to
--    Gemini; the counter table itself is invisible to clients so nobody can
--    reset their own count.
create table ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  day date not null,
  kind text not null,
  calls int not null default 0,
  primary key (user_id, day, kind)
);

alter table ai_usage enable row level security;
-- no policies: only the security-definer function below touches it
grant select, insert, update, delete on ai_usage to service_role;

create or replace function claim_ai_call(p_kind text, p_limit int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  n int;
begin
  if uid is null then return false; end if;
  insert into ai_usage (user_id, day, kind, calls)
    values (uid, (now() at time zone 'utc')::date, p_kind, 1)
  on conflict (user_id, day, kind) do update set calls = ai_usage.calls + 1
  returning calls into n;
  return n <= p_limit;
end $$;

revoke all on function claim_ai_call(text, int) from public, anon;
grant execute on function claim_ai_call(text, int) to authenticated, service_role;
