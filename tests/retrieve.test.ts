import { describe, expect, it } from "vitest";
import { effectiveConfidence, HeuristicRetriever } from "@/lib/memory/retrieve";
import { makeLoop, makeMemory } from "./fixtures";

const retriever = new HeuristicRetriever();
const base = { userMessage: "", recentEntities: [], openLoops: [] };

describe("HeuristicRetriever", () => {
  it("ranks entity-matched memories above generic ones", () => {
    const sarah = makeMemory({
      content: "interested in Sarah",
      entities: [{ type: "person", name: "Sarah" }],
      keywords: ["sarah"],
    });
    const other = makeMemory({ content: "likes hiking", importance: 5 });
    const out = retriever.retrieve([sarah, other], {
      ...base,
      userMessage: "Sarah texted me back",
    });
    expect(out[0].memory.id).toBe(sarah.id);
  });

  it("decays confidence for stale memories — she forgets", () => {
    const old = makeMemory({
      confidence: 0.5,
      created_at: new Date(Date.now() - 90 * 86_400_000).toISOString(),
      last_referenced_at: null,
    });
    expect(effectiveConfidence(old)).toBeLessThan(0.1);
    const fresh = makeMemory({ confidence: 0.5 });
    expect(effectiveConfidence(fresh)).toBeCloseTo(0.5, 1);
  });

  it("marks low-confidence recalls as fuzzy", () => {
    const m = makeMemory({ confidence: 0.3, importance: 9, keywords: ["job"] });
    const out = retriever.retrieve([m], { ...base, userMessage: "my job today" });
    expect(out[0]?.fuzzy).toBe(true);
  });

  it("drops memories whose decayed confidence is too low to inject", () => {
    const m = makeMemory({
      confidence: 0.3,
      created_at: new Date(Date.now() - 200 * 86_400_000).toISOString(),
    });
    const out = retriever.retrieve([m], { ...base, userMessage: "anything" });
    expect(out).toHaveLength(0);
  });

  it("pulls linked memories as a cluster beyond the top-K cutoff", () => {
    // Cluster expansion exists to surface linked memories that rank below
    // the retrieval cutoff — so give the linked memory a low standalone score.
    const fillers = Array.from({ length: 9 }, (_, i) =>
      makeMemory({ content: `filler ${i}`, importance: 9, keywords: [`f${i}`] })
    );
    const linked = makeMemory({
      content: "user anxious about the reply",
      importance: 2,
      keywords: [],
    });
    const main = makeMemory({
      content: "waiting for Sarah to reply",
      keywords: ["sarah"],
      related_memory_ids: [linked.id],
      importance: 8,
    });
    const out = retriever.retrieve([main, linked, ...fillers], {
      ...base,
      userMessage: "sarah still hasn't texted",
    });
    expect(out.find((r) => r.memory.id === linked.id)?.viaCluster).toBe(true);
  });

  it("boosts memories tied to active open loops", () => {
    const m = makeMemory({ id: "m-loop", content: "interview friday", importance: 5 });
    const loop = makeLoop({ related_memory_ids: ["m-loop"] });
    const other = makeMemory({ content: "likes hiking", importance: 5 });
    const out = retriever.retrieve([m, other], { ...base, openLoops: [loop] });
    expect(out[0].memory.id).toBe("m-loop");
  });

  it("semantic similarity surfaces memories keywords would miss", () => {
    // "interview" has no lexical overlap with "job application" — only the
    // embedding score can lift it. Simulated as a match_memories result.
    const semantic = makeMemory({
      id: "m-sem",
      content: "User applied to a new job",
      importance: 3,
      keywords: ["career"],
    });
    const other = makeMemory({
      content: "likes hiking",
      importance: 6,
      keywords: ["hiking"],
    });
    const out = retriever.retrieve([semantic, other], {
      ...base,
      userMessage: "the interview went well",
      semanticScores: new Map([["m-sem", 0.85]]),
    });
    expect(out[0].memory.id).toBe("m-sem");
  });

  it("heuristics still gate semantic hits — stale low-confidence stays out", () => {
    const stale = makeMemory({
      id: "m-stale",
      content: "mentioned a concert once",
      importance: 2,
      confidence: 0.2,
      created_at: new Date(Date.now() - 400 * 86_400_000).toISOString(),
      last_referenced_at: null,
    });
    const out = retriever.retrieve([stale], {
      ...base,
      userMessage: "concerts",
      semanticScores: new Map([["m-stale", 0.9]]),
    });
    expect(out).toHaveLength(0);
  });
});
