-- ── RLS hardening ───────────────────────────────────────────────────────────
-- The anon key is public by design, so "for all" own-row policies are a write
-- API for anyone with devtools. This migration closes the exploitable ones:
--
--   1. usage was fully client-writable — one DELETE wiped daily+lifetime
--      counters and bypassed the free-tier cap. Now select-only; all writes
--      flow through security-definer RPCs that reject foreign user_ids.
--      (increment_usage was called from the app but never defined — created
--      here, so lib/usage.ts stops silently falling back to non-atomic writes.)
--   2. her_commitments was world-readable — leaked promises she made to other
--      users. Only the service-side day generator reads it; drop the policy.
--   3. profiles.created_at was self-writable — inflating daysKnown unlocked
--      every time-gated photo. The 0015 trigger now freezes it on UPDATE.
--   4. media: bucket goes private, media_assets only shows assets a user has
--      actually been sent. Service role signs URLs; the library index and the
--      bucket stop being a public dump of tiered/unreleased photos.

-- 1 ── usage: reads stay (the meter), writes move behind definer RPCs ─────────
drop policy if exists "own usage" on usage;
create policy "read own usage" on usage
  for select using (auth.uid() = user_id);

-- Both gate functions get the same guard: under security definer, auth.uid()
-- still reflects the caller — reject anyone writing a user_id that isn't theirs
-- (service_role/dashboard calls pass through unrestricted).
create or replace function usage_gate(
  p_user_id uuid,
  p_date date,
  p_daily int,
  p_total int
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today int;
  v_total int;
begin
  if auth.role() in ('authenticated', 'anon') and p_user_id <> auth.uid() then
    raise exception 'forbidden';
  end if;

  insert into usage (user_id, date, message_count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, date)
  do update set message_count = usage.message_count + 1
  returning message_count into v_today;

  select coalesce(sum(message_count), 0) into v_total
  from usage where user_id = p_user_id;

  return jsonb_build_object(
    'allowed', v_today <= p_daily and v_total <= p_total,
    'reason', case
      when v_total > p_total then 'total'
      when v_today > p_daily then 'daily'
    end,
    'usedToday', v_today,
    'usedTotal', v_total
  );
end $$;

-- Called by lib/usage.ts but never existed — the fallback upsert rode on the
-- permissive policy this migration removes.
create or replace function increment_usage(
  p_user_id uuid,
  p_date date
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() in ('authenticated', 'anon') and p_user_id <> auth.uid() then
    raise exception 'forbidden';
  end if;

  insert into usage (user_id, date, message_count)
  values (p_user_id, p_date, 1)
  on conflict (user_id, date)
  do update set message_count = usage.message_count + 1;
end $$;

-- 2 ── her_commitments: service-side day generation is the only reader ────────
drop policy if exists "read her_commitments" on her_commitments;

-- 3 ── profiles: created_at is relationship tenure — not user-editable ────────
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
      new.created_at := old.created_at;
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

-- 4 ── media: private bucket + assets visible only once actually sent ─────────
update storage.buckets set public = false where id = 'josefine-media';
drop policy if exists "public read josefine media" on storage.objects;
-- No authenticated storage read policy on purpose: only the service role can
-- sign URLs, so knowing a storage_path is worthless without the app.

drop policy if exists "media assets readable" on media_assets;
create policy "media assets received only" on media_assets
  for select using (
    exists (
      select 1 from media_sends s
      where s.asset_id = media_assets.id and s.user_id = auth.uid()
    )
  );
