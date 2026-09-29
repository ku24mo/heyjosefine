import type { SupabaseClient } from "@supabase/supabase-js";
import { embedText } from "@/lib/ai/embed";
import { CONFIG } from "@/lib/config";
import type { MemoryRow, OpenLoopRow } from "@/lib/types";

/**
 * MemoryRetriever — provider-agnostic retrieval interface.
 *
 * The orchestrator only ever calls `retrieve()`. V1 is heuristic
 * (importance × recency × entity/keyword overlap × open-loop − staleness);
 * a SemanticRetriever using the `memories.embedding` column can be swapped
 * in later with zero changes to callers.
 */

export interface RetrievalContext {
  userMessage: string;
  recentEntities: string[]; // entity names seen in recent messages
  openLoops: OpenLoopRow[];
  maxResults?: number;
  /** memory id → cosine similarity, from match_memories RPC (optional). */
  semanticScores?: Map<string, number>;
}

export interface RetrievedMemory {
  memory: MemoryRow;
  score: number;
  /** effective confidence after staleness decay */
  effectiveConfidence: number;
  /** true → inject as fuzzy/hedged recall ("wait, didn't you say…?") */
  fuzzy: boolean;
  viaCluster?: boolean;
}

export interface MemoryRetriever {
  retrieve(all: MemoryRow[], ctx: RetrievalContext): RetrievedMemory[];
}

/**
 * Embed the incoming message → cosine-similar memory ids. Returns undefined
 * when embeddings aren't configured or fail — heuristic retrieval still runs.
 */
export async function semanticScoresFor(
  supabase: SupabaseClient,
  userId: string,
  text: string,
  limit = 40
): Promise<Map<string, number> | undefined> {
  const q = await embedText(text);
  if (!q) return undefined;
  const { data, error } = await supabase.rpc("match_memories", {
    p_user_id: userId,
    p_embedding: q,
    p_limit: limit,
  });
  if (error || !data?.length) return undefined;
  return new Map(
    (data as { id: string; similarity: number }[]).map((r) => [
      r.id,
      r.similarity,
    ])
  );
}

function daysSince(iso: string | null): number {
  if (!iso) return 999;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

/** Confidence decays with time since last reference. */
export function effectiveConfidence(m: MemoryRow): number {
  const age = daysSince(m.last_referenced_at ?? m.created_at);
  const decay = Math.pow(0.5, age / CONFIG.memory.decayHalfLifeDays);
  return m.confidence * decay;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9åäö\s]/gi, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export class HeuristicRetriever implements MemoryRetriever {
  retrieve(all: MemoryRow[], ctx: RetrievalContext): RetrievedMemory[] {
    const active = all.filter((m) => m.status === "active");
    const msgTokens = new Set(tokenize(ctx.userMessage));
    const entityNames = new Set(ctx.recentEntities.map((e) => e.toLowerCase()));
    const loopMemoryIds = new Set(
      ctx.openLoops
        .filter((l) => l.status === "active")
        .flatMap((l) => l.related_memory_ids)
    );

    const scored: RetrievedMemory[] = active.map((m) => {
      const conf = effectiveConfidence(m);
      let score = 0;

      // importance (0–10 → 0–1.0)
      score += (m.importance / 10) * 0.9;
      // recency of reference
      score += Math.max(0, 0.6 - daysSince(m.created_at) * 0.01);
      // keyword overlap with current message
      const kwHits = m.keywords.filter((k) =>
        tokenize(k).some((t) => msgTokens.has(t))
      ).length;
      score += Math.min(kwHits * 0.35, 1.0);
      // entity match against recent conversation entities
      const entHits = m.entities.filter(
        (e) => entityNames.has(e.name.toLowerCase()) || msgTokens.has(e.name.toLowerCase())
      ).length;
      score += Math.min(entHits * 0.5, 1.2);
      // linked to an active open loop
      if (loopMemoryIds.has(m.id)) score += 0.6;
      // semantic similarity — embedded recall ("interview" finds "job app")
      const sim = ctx.semanticScores?.get(m.id);
      if (sim != null) score += Math.max(0, sim) * 1.4;
      // staleness penalty — she doesn't robotically recall everything
      score -= Math.min(daysSince(m.last_referenced_at) * 0.008, 0.35);
      // patterns require more evidence to surface
      if (m.category === "pattern") score *= m.evidence_count >= 2 ? 0.9 : 0.4;

      return {
        memory: m,
        score,
        effectiveConfidence: conf,
        fuzzy: conf < CONFIG.memory.fuzzyBelow,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    const max = ctx.maxResults ?? CONFIG.memory.maxRetrieved;
    const picked = scored
      .filter((r) => r.effectiveConfidence >= CONFIG.memory.minInjectConfidence)
      .slice(0, max);

    // Cluster expansion: pull 1-hop linked memories of picked items.
    const byId = new Map(active.map((m) => [m.id, m]));
    const pickedIds = new Set(picked.map((p) => p.memory.id));
    const cluster: RetrievedMemory[] = [];
    for (const p of picked) {
      for (const linkedId of p.memory.related_memory_ids) {
        if (pickedIds.has(linkedId) || cluster.length >= CONFIG.memory.maxClusterExpansion)
          continue;
        const linked = byId.get(linkedId);
        if (!linked || linked.status !== "active") continue;
        const conf = effectiveConfidence(linked);
        if (conf < CONFIG.memory.minInjectConfidence) continue;
        pickedIds.add(linkedId);
        cluster.push({
          memory: linked,
          score: p.score * 0.8,
          effectiveConfidence: conf,
          fuzzy: conf < CONFIG.memory.fuzzyBelow,
          viaCluster: true,
        });
      }
    }

    return [...picked, ...cluster];
  }
}
