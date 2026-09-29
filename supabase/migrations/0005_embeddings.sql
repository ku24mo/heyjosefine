-- ── semantic memory retrieval ───────────────────────────────────────────────
-- The vector(1536) column is already provisioned (0001); this adds the index
-- and the similarity RPC — PostgREST can't express the <=> cosine operator.

create index if not exists memories_embedding_idx
  on memories using hnsw (embedding vector_cosine_ops);

create or replace function match_memories(
  p_user_id uuid,
  p_embedding vector(1536),
  p_limit int default 40
) returns table(id uuid, similarity float)
language sql stable as $$
  select id, 1 - (embedding <=> p_embedding) as similarity
  from memories
  where user_id = p_user_id
    and status = 'active'
    and embedding is not null
  order by embedding <=> p_embedding
  limit p_limit;
$$;
