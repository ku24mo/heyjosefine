-- ── media sends ─────────────────────────────────────────────────────────────
-- Josefine's photo library + the per-user send ledger.
-- media_assets: curated assets, labelled by folder/filename convention and
--   imported via scripts/media-import.ts.
-- media_sends: (user_id, asset_id) ledger — the never-send-twice guarantee
--   is structural, not probabilistic.

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  subject text not null,                    -- odin | food | self | scene | car | tennis | gym | casting ...
  tags text[] not null default '{}',        -- scene/mood hints: rain, morning, comfort ...
  intimacy_tier int not null default 1 check (intimacy_tier between 1 and 3),
  unlock_day int not null default 1,        -- days since they met (profiles.created_at)
  storage_path text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists media_assets_pick_idx
  on media_assets(enabled, unlock_day, intimacy_tier, subject);

create table if not exists media_sends (
  user_id uuid not null references profiles(id) on delete cascade,
  asset_id uuid not null references media_assets(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (user_id, asset_id)
);
create index if not exists media_sends_user_idx on media_sends(user_id, sent_at);

alter table media_assets enable row level security;
alter table media_sends enable row level security;

-- Assets are deliverable content, not secrets — any authenticated user can
-- read the library index; actual sends are per-user private.
drop policy if exists "media assets readable" on media_assets;
create policy "media assets readable" on media_assets
  for select using (true);
drop policy if exists "own media sends" on media_sends;
create policy "own media sends" on media_sends
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Storage bucket for the library. Public read: curated assets served via CDN.
insert into storage.buckets (id, name, public)
values ('josefine-media', 'josefine-media', true)
on conflict (id) do nothing;

drop policy if exists "public read josefine media" on storage.objects;
create policy "public read josefine media" on storage.objects
  for select using (bucket_id = 'josefine-media');
