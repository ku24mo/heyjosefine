import { describe, expect, it } from "vitest";
import { dedupeNewMemories } from "@/lib/memory/dedupe";
import { makeMemory } from "./fixtures";

const base = {
  content: "x",
  importance: 6,
  confidence: 0.9,
  keywords: ["job"],
  entities: [],
  learned_from_user: false,
  supporting_memory_ids: [] as string[],
};

describe("memory dedupe + guards", () => {
  it("drops memories below the importance threshold", () => {
    const r = dedupeNewMemories(
      [{ ...base, category: "emotion", importance: 2, content: "user was tired" }],
      []
    );
    expect(r.accepted).toHaveLength(0);
  });

  it("downgrades 'pattern' without enough supporting evidence", () => {
    const r = dedupeNewMemories(
      [{ ...base, category: "pattern", content: "user overthinks dating", confidence: 0.9 }],
      []
    );
    // no supporting memories → downgraded to emotion at lower confidence
    expect(r.accepted[0]?.category).toBe("emotion");
    expect(r.accepted[0]?.confidence).toBeLessThanOrEqual(0.6);
  });

  it("accepts 'pattern' with real supporting memory ids", () => {
    const m1 = makeMemory({ content: "user overthought a text" });
    const m2 = makeMemory({ content: "user spiraled about a reply" });
    const r = dedupeNewMemories(
      [
        {
          ...base,
          category: "pattern",
          content: "user tends to overthink dating situations",
          confidence: 0.85,
          supporting_memory_ids: [m1.id, m2.id],
        },
      ],
      [m1, m2]
    );
    expect(r.accepted[0]?.category).toBe("pattern");
  });

  it("reinforces duplicates by entity overlap instead of storing copies", () => {
    const existing = makeMemory({
      category: "relationship",
      content: "User is interested in Sarah",
      entities: [{ type: "person", name: "Sarah" }],
      keywords: ["sarah", "dating"],
    });
    const r = dedupeNewMemories(
      [
        {
          ...base,
          category: "relationship",
          content: "User went on a date with Sarah",
          keywords: ["sarah", "date"],
          entities: [{ type: "person", name: "Sarah" }],
        },
      ],
      [existing]
    );
    expect(r.accepted).toHaveLength(0);
    expect(r.reinforced).toEqual([existing.id]);
  });
});
