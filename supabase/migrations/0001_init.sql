-- Josefine V1 schema
-- Run in Supabase SQL editor or via `supabase db push`.

create extension if not exists vector; -- pgvector: reserved for semantic retrieval

-- ── profiles ────────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  onboarded boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── conversations ───────────────────────────────────────────────────────────
create table conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index conversations_user_idx on conversations(user_id);

-- ── messages ────────────────────────────────────────────────────────────────
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  meta jsonb not null default '{}', -- plan, directives, intention, beat, bubble_index
  created_at timestamptz not null default now()
);
create index messages_conversation_idx on messages(conversation_id, created_at);

-- ── memories ────────────────────────────────────────────────────────────────
create table memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  category text not null check (category in
    ('personal_fact','goal','relationship','preference','emotion','event','pattern')),
  content text not null,
  importance int not null check (importance between 1 and 10),
  confidence real not null default 1.0 check (confidence between 0 and 1),
  keywords text[] not null default '{}',
  entities jsonb not null default '[]',   -- [{type: person|place|event|goal|conversation, name}]
  related_memory_ids uuid[] not null default '{}',
  learned_from_user boolean not null default false,
  evidence_count int not null default 1,
  supporting_memory_ids uuid[] not null default '{}',
  status text not null default 'active' check (status in ('active','archived')),
  source_message_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  last_referenced_at timestamptz,
  embedding vector(1536) -- reserved for SemanticRetriever; unused in V1
);
create index memories_user_idx on memories(user_id, status, importance desc);
create index memories_keywords_idx on memories using gin(keywords);

-- ── open_loops ──────────────────────────────────────────────────────────────
create table open_loops (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  description text not null,
  status text not null default 'active'
    check (status in ('active','resolved','cancelled','stale')),
  importance int not null default 5 check (importance between 1 and 10),
  emotional_weight int not null default 5 check (emotional_weight between 1 and 10),
  related_memory_ids uuid[] not null default '{}',
  due_hint timestamptz,
  last_nudged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index open_loops_user_idx on open_loops(user_id, status);

-- ── conversation_state ──────────────────────────────────────────────────────
create table conversation_state (
  user_id uuid primary key references profiles(id) on delete cascade,

  -- behavioural register (derived, never randomized, never surfaced as literal feelings)
  mood text not null default 'neutral',
  energy real not null default 0.7 check (energy between 0 and 1),
  warmth real not null default 0.6 check (warmth between 0 and 1),
  curiosity real not null default 0.7 check (curiosity between 0 and 1),
  seriousness real not null default 0.4 check (seriousness between 0 and 1),
  her_mood text not null default 'neutral',   -- her simulated mood (from life threads)
  her_energy real not null default 0.7 check (her_energy between 0 and 1),

  -- conversational arc
  current_beat text not null default 'free_chat',
  beat_started_at timestamptz,
  current_topic text,
  summary text not null default '',            -- "what's happening right now"
  consecutive_ai_questions int not null default 0,
  act_histogram jsonb not null default '{}',   -- rolling tally of assistant intentions
  recent_emotion text,

  -- relationship
  familiarity int not null default 0 check (familiarity between 0 and 100),
  stage text not null default 'new'
    check (stage in ('new','warming','familiar','close')),
  days_active int not null default 0,
  active_dates date[] not null default '{}',
  depth_points int not null default 0,        -- accumulated meaningful exchanges (≤ once/day)
  last_depth_date date,
  first_met_at timestamptz not null default now(),
  last_interaction_at timestamptz,

  updated_at timestamptz not null default now()
);

-- ── life threads (her world — global, seeded from lib/persona/life/) ─────────
create table life_threads (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  status text not null default 'active' check (status in ('active','resolved','paused')),
  emotional_impact text,
  disclosure_tier int not null default 1 check (disclosure_tier between 1 and 3),
  she_wants_to_talk boolean not null default true,
  can_open boolean not null default false,
  timeline jsonb not null default '[]',        -- [{at: "0d", development: "..."}]
  body text not null default '',
  seeded_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- ── life_thread_state (what this user knows about a thread) ─────────────────
create table life_thread_state (
  user_id uuid not null references profiles(id) on delete cascade,
  thread_id uuid not null references life_threads(id) on delete cascade,
  last_mentioned_at timestamptz,
  awareness_stage int not null default 0, -- index into timeline revealed to this user
  primary key (user_id, thread_id)
);

-- ── usage ───────────────────────────────────────────────────────────────────
create table usage (
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  message_count int not null default 0,
  primary key (user_id, date)
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table memories enable row level security;
alter table open_loops enable row level security;
alter table conversation_state enable row level security;
alter table life_threads enable row level security;
alter table life_thread_state enable row level security;
alter table usage enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own conversations" on conversations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own messages" on messages
  for all using (
    exists (select 1 from conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  ) with check (
    exists (select 1 from conversations c
            where c.id = messages.conversation_id and c.user_id = auth.uid())
  );

create policy "own memories" on memories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own open_loops" on open_loops
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own conversation_state" on conversation_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "read life_threads" on life_threads
  for select using (true); -- her world is shared; per-user awareness is what varies

create policy "own life_thread_state" on life_thread_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own usage" on usage
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
