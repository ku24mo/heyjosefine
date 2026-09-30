-- ── her days ─────────────────────────────────────────────────────────────────
-- One row per Stockholm date, GLOBAL (not per-user): she has one Tuesday for
-- everyone — that's the "real person" property. The day sheet precommits her
-- schedule so claims made in chat ("shoot tomorrow") materialize into reality
-- instead of being improvised per-turn.

create table if not exists her_days (
  day date primary key,                    -- Stockholm date (Europe/Stockholm)
  slots jsonb not null default '[]',       -- [{start:"08:00", end:"10:00", label, kind}]
  headline text,                           -- one-line "how the day went" — seeds tomorrow
  generated_at timestamptz not null default now()
);

-- Dated claims she made in chat → next day's generation consumes them.
create table if not exists her_commitments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,  -- who she said it to (audit only)
  target_day date not null,
  content text not null,
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists her_commitments_day_idx
  on her_commitments(target_day) where not consumed;

alter table her_days enable row level security;
alter table her_commitments enable row level security;

-- her_days is canon-ish world state — authenticated users may read it.
drop policy if exists "read her_days" on her_days;
create policy "read her_days" on her_days for select using (true);

-- Commitments are her-life events, not secrets — day generation must see ALL
-- users' commitments (the sheet is global), so select is open; writes stay
-- owner-scoped (the user she made the promise to).
drop policy if exists "read her_commitments" on her_commitments;
create policy "read her_commitments" on her_commitments
  for select using (true);
drop policy if exists "insert own her_commitments" on her_commitments;
create policy "insert own her_commitments" on her_commitments
  for insert with check (auth.uid() = user_id);
drop policy if exists "update own her_commitments" on her_commitments;
create policy "update own her_commitments" on her_commitments
  for update using (auth.uid() = user_id);
