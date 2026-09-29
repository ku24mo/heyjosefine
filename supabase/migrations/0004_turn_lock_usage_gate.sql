-- ── turn lock ───────────────────────────────────────────────────────────────
-- Serializes orchestration per user: concurrent sends (double-texts, two tabs,
-- retries) queue instead of racing reads/writes on the same state + memories.
-- A stale lock expires after TTL — a crashed turn can't wedge the account.
alter table conversation_state
  add column if not exists turn_locked_at timestamptz;

-- ── atomic usage gate ───────────────────────────────────────────────────────
-- check+increment in one function under the row lock — a double-submit can't
-- slip past the daily/total cap anymore. Counts before knowing the outcome:
-- denied sends consume quota too, which doubles as abuse protection.
create or replace function usage_gate(
  p_user_id uuid,
  p_date date,
  p_daily int,
  p_total int
) returns jsonb language plpgsql as $$
declare
  v_today int;
  v_total int;
begin
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
