-- ── burst gate ──────────────────────────────────────────────────────────────
-- Per-minute rapid-fire cap on top of the daily/lifetime gate — protects LLM
-- spend from spam/loops, not the relationship. State lives on conversation_state
-- (the per-user row that already exists), updated atomically under its row lock.
alter table conversation_state
  add column if not exists burst_count int not null default 0,
  add column if not exists burst_window_start timestamptz;

create or replace function burst_gate(
  p_user_id uuid,
  p_limit int,
  p_window_seconds int default 60
) returns jsonb language plpgsql as $$
declare
  v_window timestamptz;
  v_count int;
begin
  update conversation_state
  set
    burst_window_start = case
      when burst_window_start is null
        or burst_window_start < now() - make_interval(secs => p_window_seconds)
      then now()
      else burst_window_start
    end,
    burst_count = case
      when burst_window_start is null
        or burst_window_start < now() - make_interval(secs => p_window_seconds)
      then 1
      else burst_count + 1
    end
  where user_id = p_user_id
  returning burst_window_start, burst_count into v_window, v_count;

  if not found then
    return jsonb_build_object('allowed', true, 'count', 0);
  end if;

  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count);
end $$;

-- ── one active conversation per user ────────────────────────────────────────
-- Reset semantics keep old threads (memories persist), but only the newest is
-- active. The partial unique index closes the concurrent-first-message race.
alter table conversations
  add column if not exists is_active boolean not null default true;

-- A user who already has history shouldn't gain a second "active" thread.
update conversations c set is_active = false
where exists (
  select 1 from conversations newer
  where newer.user_id = c.user_id and newer.created_at > c.created_at
);

create unique index if not exists conversations_one_active_idx
  on conversations(user_id) where is_active;
