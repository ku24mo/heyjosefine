-- ── guest gate ──────────────────────────────────────────────────────────────
-- Per-IP cap on anonymous sign-ups — a refarmer can't mint infinite identities.
-- Same atomic-window pattern as burst_gate; keyed by IP, not user.

create table if not exists guest_gate (
  ip inet primary key,
  window_start timestamptz not null default now(),
  count int not null default 0
);

create or replace function guest_gate(
  p_ip inet,
  p_limit int,
  p_window_seconds int default 86400
) returns jsonb language plpgsql as $$
declare
  v_count int;
begin
  insert into guest_gate (ip, window_start, count)
  values (p_ip, now(), 1)
  on conflict (ip) do update set
    window_start = case
      when guest_gate.window_start < now() - make_interval(secs => p_window_seconds)
      then now()
      else guest_gate.window_start
    end,
    count = case
      when guest_gate.window_start < now() - make_interval(secs => p_window_seconds)
      then 1
      else guest_gate.count + 1
    end
  returning count into v_count;

  return jsonb_build_object('allowed', v_count <= p_limit, 'count', v_count);
end $$;
