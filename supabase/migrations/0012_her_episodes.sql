-- ── her episodes ─────────────────────────────────────────────────────────────
-- Things SHE told him about her own life — consistency anchors that decay like
-- normal memories. Reuses the memories table: dedupe, embeddings, staleness
-- decay, and the consolidation cron all apply for free.

alter table memories drop constraint if exists memories_category_check;
alter table memories add constraint memories_category_check check (
  category in ('personal_fact','goal','relationship','preference','emotion','event','pattern','her_episode')
);
