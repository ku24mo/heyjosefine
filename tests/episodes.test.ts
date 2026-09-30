import { describe, expect, it } from "vitest";
import { dedupeNewEpisodes } from "@/lib/memory/dedupe";
import { extractionSchema } from "@/lib/ai/schemas";
import { effectiveConfidence } from "@/lib/memory/retrieve";
import type { MemoryRow } from "@/lib/types";

const ep = (over: Partial<Parameters<typeof dedupeNewEpisodes>[0][0]> = {}) => ({
  content: "she said the shoot ran three hours over",
  importance: 3,
  keywords: ["shoot", "client"],
  entities: [{ type: "event", name: "shoot" }],
  thread_slug: "shoot",
  ...over,
});

const row = (over: Partial<MemoryRow>): MemoryRow => ({
  id: over.id ?? "m1",
  user_id: "u",
  category: "her_episode",
  content: "x",
  importance: 3,
  confidence: 1.0,
  keywords: ["shoot"],
  entities: [{ type: "event", name: "shoot" }],
  related_memory_ids: [],
  learned_from_user: false,
  evidence_count: 1,
  supporting_memory_ids: [],
  status: "active",
  source_message_id: null,
  created_at: new Date().toISOString(),
  last_referenced_at: null,
  ...over,
});

describe("extraction schema — her-side channels", () => {
  it("accepts her_episodes and her_commitments", () => {
    const out = extractionSchema.parse({
      conversation_summary: "s",
      new_memories: [],
      her_episodes: [ep()],
      her_commitments: [{ day_hint: "tomorrow", content: "the shoot" }],
      memory_updates: [],
      open_loop_updates: [],
    });
    expect(out.her_episodes).toHaveLength(1);
    expect(out.her_commitments[0].day_hint).toBe("tomorrow");
  });

  it("defaults both channels to empty — old outputs still parse", () => {
    const out = extractionSchema.parse({ conversation_summary: "s" });
    expect(out.her_episodes).toEqual([]);
    expect(out.her_commitments).toEqual([]);
  });
});

describe("dedupeNewEpisodes — lower bar than user facts, then fades", () => {
  it("accepts flavor below the user-fact gate (importance 2–3)", () => {
    const { accepted } = dedupeNewEpisodes([ep({ importance: 2 })], []);
    expect(accepted).toHaveLength(1);
  });

  it("still drops true noise (importance 1)", () => {
    const { accepted } = dedupeNewEpisodes([ep({ importance: 1 })], []);
    expect(accepted).toHaveLength(0);
  });

  it("dedupes against existing her_episode rows, not user memories", () => {
    const sameEpisode = row({ id: "ep1" });
    const userFact = row({ id: "u1", category: "personal_fact" });
    const { reinforced } = dedupeNewEpisodes([ep()], [sameEpisode, userFact]);
    expect(reinforced).toEqual(["ep1"]); // episode matched episode, not the user fact
  });

  it("caps episodes per turn", () => {
    const many = Array.from({ length: 6 }, (_, i) =>
      ep({ keywords: [`k${i}`], entities: [{ type: "thing", name: `t${i}` }] })
    );
    expect(dedupeNewEpisodes(many, []).accepted.length).toBeLessThanOrEqual(3);
  });

  it("episodes fade like human memory — confidence decays with age", () => {
    const fresh = row({ created_at: new Date().toISOString() });
    const old = row({
      created_at: new Date(Date.now() - 45 * 86_400_000).toISOString(),
    });
    expect(effectiveConfidence(old)).toBeLessThan(effectiveConfidence(fresh));
    // ~45 days unreinforced at 21d half-life → below inject threshold
    expect(effectiveConfidence(old)).toBeLessThan(0.25);
  });
});
