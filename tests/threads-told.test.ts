import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "@/lib/ai/prompts";
import { makeState } from "./fixtures";
import type { Intention, LifeThreadRow, LifeThreadStateRow } from "@/lib/types";

const intention: Intention = {
  acts: ["react"],
  openness: "leave_open",
  targetLength: "short",
  form: "single",
};

const thread = (seededDaysAgo: number): LifeThreadRow => ({
  id: "t1",
  slug: "odin",
  title: "Odin being Odin",
  status: "active",
  emotional_impact: "warm",
  disclosure_tier: 1,
  she_wants_to_talk: true,
  can_open: true,
  timeline: [
    { at: "0d", development: "sock theft" },
    { at: "3d", development: "cushion destroyed" },
  ],
  body: "…",
  seeded_at: new Date(Date.now() - seededDaysAgo * 86_400_000).toISOString(),
  resolved_at: null,
});

const told = (stage: number, mentionedDaysAgo = 3): LifeThreadStateRow => ({
  user_id: "u1",
  thread_id: "t1",
  last_mentioned_at: new Date(
    Date.now() - mentionedDaysAgo * 86_400_000
  ).toISOString(),
  awareness_stage: stage,
});

const prompt = (
  threads: LifeThreadRow[],
  states: LifeThreadStateRow[]
) =>
  buildSystemPrompt({
    state: makeState(),
    stage: "familiar",
    tier: 2,
    memories: [],
    openLoops: [],
    lifeThreads: threads,
    threadStates: states,
    directives: [],
    intention,
    isFirstConversation: false,
  });

describe("thread told-tracking — escalate, never re-tell", () => {
  it("a beat he's heard is annotated as such", () => {
    // seeded 5d ago → current dev = index 1; he heard index 1 already
    const p = prompt([thread(5)], [told(1, 3)]);
    expect(p).toContain("he's heard this beat");
  });

  it("a NEW beat on a known thread is not marked as heard", () => {
    // current dev = index 1; he only heard index 0
    const p = prompt([thread(5)], [told(0, 3)]);
    expect(p).toContain("cushion destroyed");
    expect(p).not.toContain("he's heard this beat");
  });

  it("a never-mentioned thread shows no annotation", () => {
    const p = prompt([thread(5)], []);
    expect(p).toContain("cushion destroyed");
    expect(p).not.toContain("heard this beat");
    expect(p).not.toContain("recently");
  });

  it("mentioned inside the cooldown gets the 'recently' tag", () => {
    // day-0 beat only (fresh thread), told today → heard AND recent
    const p = prompt([thread(0)], [told(0, 0)]);
    expect(p).toContain("heard this beat");
  });
});
