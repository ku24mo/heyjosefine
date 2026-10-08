-- Cross-device claim flag: an anonymous user who claims (email+password) is
-- still anonymous until they tap the confirm link — possibly on another
-- device where localStorage flags don't exist. claim_pending marks the
-- intent server-side so /api/auth/claimed can finish the usage wipe on the
-- first confirmed mount, from any device.
alter table profiles
  add column if not exists claim_pending boolean not null default false;

-- Service-owned columns guard. The "own profile" RLS policy allows full-row
-- self-update (auth.uid() = id), so without this a session client could set
-- plan='unlimited' or flip claim_pending for a free usage reset. Trigger
-- forces billing/claim columns back to their old value (or defaults) for
-- session-role writes; service_role and dashboard SQL are unaffected.
create or replace function profiles_protect_service_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') then
    if tg_op = 'UPDATE' then
      new.plan := old.plan;
      new.stripe_customer_id := old.stripe_customer_id;
      new.stripe_subscription_id := old.stripe_subscription_id;
      new.subscription_status := old.subscription_status;
      new.current_period_end := old.current_period_end;
      new.claim_pending := old.claim_pending;
    else
      new.plan := 'free';
      new.stripe_customer_id := null;
      new.stripe_subscription_id := null;
      new.subscription_status := null;
      new.current_period_end := null;
      new.claim_pending := false;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists profiles_protect_service_columns on profiles;
create trigger profiles_protect_service_columns
  before insert or update on profiles
  for each row execute function profiles_protect_service_columns();
