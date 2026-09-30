-- ── milestones ──────────────────────────────────────────────────────────────
-- Tracks which relationship anniversaries she has already celebrated so each
-- milestone opener fires exactly once, across devices and sessions.

alter table conversation_state
  add column if not exists last_milestone_day int not null default 0;
