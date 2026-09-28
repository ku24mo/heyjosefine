import { CONFIG } from "@/lib/config";
import type { MemoryCategory, MemoryRow } from "@/lib/types";
import type { ExtractionOutput } from "@/lib/ai/schemas";

/**
 * Dedupe + guardrail logic for extracted memories.
 * Deterministic — the model proposes, this layer disposes.
 */

export interface NewMemory {
  category: MemoryCategory;
  content: string;
  importance: number;
  confidence: number;
  keywords: string[];
  entities: { type: string; name: string }[];
  learned_from_user: boolean;
  supporting_memory_ids: string[];
}

export interface DedupeResult {
  /** memories that pass all guards, ready to insert */
  accepted: NewMemory[];
  /** ids of existing memories to bump last_referenced_at (reinforced, not duplicated) */
  reinforced: string[];
}

function tokenOverlap(a: string[], b: string[]): number {
  const set = new Set(a.map((s) => s.toLowerCase()));
  return b.filter((s) => set.has(s.toLowerCase())).length;
}

function entityOverlap(
  a: { name: string }[],
  b: { name: string }[]
): boolean {
  const set = new Set(a.map((e) => e.name.toLowerCase()));
  return b.some((e) => set.has(e.name.toLowerCase()));
}

export function dedupeNewMemories(
  candidates: ExtractionOutput["new_memories"],
  existing: MemoryRow[]
): DedupeResult {
  const reinforced: string[] = [];
  const accepted: NewMemory[] = [];

  for (const c of candidates) {
    // Importance gate — she doesn't remember trivialities.
    if (c.importance < CONFIG.memory.minImportanceToStore) continue;

    // Pattern guard: needs confidence AND ≥2 cited supporting memories —
    // enforced in code, not just the prompt.
    if (c.category === "pattern") {
      const validSupport = c.supporting_memory_ids.filter((id) =>
        existing.some((m) => m.id === id)
      );
      if (
        c.confidence < CONFIG.memory.patternMinConfidence ||
        validSupport.length < CONFIG.memory.patternMinEvidence
      ) {
        // Downgrade: it's a real observation, just not a pattern yet.
        c.category = "emotion";
        c.confidence = Math.min(c.confidence, 0.6);
      }
    }

    // Duplicate check: same category + entity or keyword overlap → reinforce
    // the existing memory instead of storing a near-copy.
    const dupe = existing.find(
      (m) =>
        m.category === c.category &&
        m.status === "active" &&
        (entityOverlap(m.entities, c.entities) ||
          tokenOverlap(m.keywords, c.keywords) >= 2)
    );
    if (dupe) {
      reinforced.push(dupe.id);
      continue;
    }

    accepted.push({
      category: c.category,
      content: c.content,
      importance: Math.round(c.importance),
      confidence: c.confidence,
      keywords: c.keywords,
      entities: c.entities,
      learned_from_user: c.learned_from_user,
      supporting_memory_ids: c.supporting_memory_ids,
    });
  }

  return { accepted, reinforced };
}
