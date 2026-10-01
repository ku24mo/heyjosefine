-- ── her requests ─────────────────────────────────────────────────────────────
-- Things HE recommends that SHE commits to (or declines): "watch money heist",
-- "read this", "try that recipe". Per-user — it's relationship state, not
-- world state like her_days. Progress is computed lazily from accepted_at +
-- pace (see lib/persona/requests.ts) — no cron; the row only records the
-- commitment and which report beats she's already sent.

create table if not exists her_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null,                  -- watch | read | listen | try | play | other
  title text not null,                 -- "money heist" — normalized at write
  detail text,                         -- "season 1", "the album", optional
  est_minutes int not null,            -- believable total runtime
  pace real not null default 1.0,      -- her speed multiplier (0.7–1.3), rolled once
  will_drop boolean not null default false, -- ~10% quit mid-way (rolled once)
  status text not null default 'doing',     -- doing | done | dropped | declined
  beats_sent text[] not null default '{}',  -- report beats already sent
  start_day date,                      -- null = accepted_at; set when she counters ("friday")
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists her_requests_user_idx
  on her_requests(user_id) where status in ('doing','declined');

alter table her_requests enable row level security;

drop policy if exists "own her_requests" on her_requests;
create policy "own her_requests" on her_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- His timezone (IANA) — groundwork for shared activities: "8pm your time"
-- needs a real zone to negotiate against her Stockholm clock.
alter table profiles add column if not exists user_tz text;
