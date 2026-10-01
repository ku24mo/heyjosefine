import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "@/lib/ai/embed";
import type { ChatModel } from "@/lib/ai/provider";
import { extractionSchema } from "@/lib/ai/schemas";
import type { MemoryRow, OpenLoopRow } from "@/lib/types";
import { dedupeNewEpisodes, dedupeNewMemories } from "./dedupe";
import { resolveDayHint } from "@/lib/persona/day";
import { semanticScoresFor } from "./retrieve";

/**
 * Async memory extraction — runs AFTER the reply is sent.
 * One extra model call per exchange; the user never waits on it.
 */

const EXTRACT_PROMPT = `You are the memory system for an AI companion. Analyze the latest exchange and output structured JSON.

MEMORY RULES — be selective, not exhaustive:
- OWNERSHIP: memories describe the USER only — the user's life, people, and world. The assistant has her own life (her dog Odin, her law school, her friends, her family). NEVER store something the ASSISTANT said about herself as a user memory. "assistant: my dog Odin stole a sock" → store nothing about a dog.
- Store only what's worth knowing later: personal facts, goals, relationships, real preferences, emotional situations, concrete events.
- NEVER store trivialities ("user was tired", "user said lol", "it's raining").
- Importance 1-10: 8-10 = life-changing/core identity; 5-7 = meaningful; 4 = borderline keep; below 4 = don't store.
- Confidence: 1.0 = explicitly stated; 0.7 = strongly implied; 0.4 = guessed.
- entities: name real anchors (people, places, events, goals) — "Sarah", "job", "the interview". These power future recall.
- learned_from_user: true ONLY when the user taught her something about the world (explained football, a game, their job jargon) — this enables "wait, didn't you say they're playing tonight?" later.
- category "pattern": ONLY for observed recurring behaviour, and ONLY with ≥2 supporting_memory_ids citing real past evidence. NEVER infer psychology from one conversation.
- If the user contradicts an existing memory, update it (memory_updates) rather than duplicating.
- related_memory_ids in memory_updates: link memories that belong to the same storyline.
- If she coins a nickname/pet name for the user in this exchange → new_memories {"category":"relationship","content":"She calls him \"X\""}. Once stored it persists — she keeps using it.

OPEN LOOPS — things with an unresolved future:
- create: interview Friday, waiting on a reply, "I'm thinking about quitting", a plan she should ask about later.
- resolve/cancel/stale when the loop closes or dies. IMPORTANT: if the user's latest message ANSWERED what a loop was waiting on — he said "will subcontract it" while a loop waits on his decision — emit {"action":"resolve","id":"..."} for that loop. Lingering answered loops make her re-ask dead questions, which reads as not listening.
- importance + emotional_weight: "buy milk" ≈ 2/2; "waiting to hear if Sarah likes me" ≈ 7/9.

HER EPISODES — what the ASSISTANT told the user about her own life:
- Store concrete claims she made that could be contradicted or called back later: "the shoot ran 3 hours over", "lecture at 8 tomorrow", "Odin shredded my cushion", "I'm at my parents' this weekend".
- Do NOT store canon she merely restated (that she has a dog, is a law student, lives in Stockholm — already known) or pure flavor with no callback value.
- Named people must come from her existing world only — never record invented names.
- Also store shared rituals/inside-jokes that emerged this exchange ("they have a goodnight-text ritual", "the sock bit is their running joke") — these let her reference them as "theirs" later.
- Importance: 2-3 for texture (a minor anecdote), 4-6 for things he'd plausibly ask about again (the shoot outcome, an upcoming exam), 7+ only for genuinely significant events.
- thread_slug: set it when the episode belongs to a known life thread, else null.

HER COMMITMENTS — dated plans she stated out loud:
- Only when she committed to a specific day: "shoot tomorrow" → {"day_hint":"tomorrow",...}, "exam friday" → {"day_hint":"friday",...}. Vague "sometime this week" → don't store.
- These become her actual schedule — only emit things she really said, not user guesses.

CONVERSATION SUMMARY — 1-3 sentences on what is happening RIGHT NOW (topic, user's state, where it's heading). This is separate from memories: summary = current situation, memory = durable facts.

EXAMPLES of correct output:

Exchange — user: "my interview is friday, kinda nervous" | assistant: "wait friday??"
→ new_memories: [{"category":"event","content":"User has a job interview Friday","importance":7,"confidence":1.0,"keywords":["interview","job","friday"],"entities":[{"type":"event","name":"job interview"}],"learned_from_user":false}]
→ open_loop_updates: [{"action":"create","description":"job interview Friday — follow up on how it went","importance":8,"emotional_weight":7}]

Exchange — user: "I'm thinking about quitting my job" | assistant: "wait what. months thing or today thing?"
→ new_memories: [{"category":"emotion","content":"User is unhappy at work and considering quitting","importance":8,"confidence":0.9,"keywords":["job","quitting","work"],"entities":[{"type":"goal","name":"quit job"}],"learned_from_user":false}]
→ open_loop_updates: [{"action":"create","description":"considering quitting job — decision pending","importance":8,"emotional_weight":8}]

Exchange — user: "lol ok" | assistant: "😂"
→ new_memories: [], open_loop_updates: [] (nothing worth storing — that's fine)

Exchange — active loops: [l9] "waiting to hear whether he subcontracted the inside work" | user: "foundations are done, we're subcontracting the inside" | assistant: "the worst part's over then"
→ open_loop_updates: [{"action":"resolve","id":"l9"}] (he answered — the thread is closed)

When in doubt between storing and not storing a MEANINGFUL item (event, relationship, goal, worry, plan), store it. Selectivity is about trivialities, not about real life.`;

export interface ExtractionResult {
  insertedMemories: number;
  reinforcedMemories: number;
  loopChanges: number;
  summary: string;
}

export async function extractAndStore(opts: {
  model: ChatModel;
  supabase: SupabaseClient;
  userId: string;
  conversationId: string;
  exchange: { role: "user" | "assistant"; content: string }[];
  existingMemories: MemoryRow[];
  existingLoops: OpenLoopRow[];
}): Promise<ExtractionResult> {
  const { model, supabase, userId, exchange } = opts;

  // Dedupe context = the memories most similar to this exchange, not a
  // blind slice — otherwise old dupes go unseen once a user passes ~40.
  const sims = await semanticScoresFor(
    supabase,
    userId,
    exchange.map((m) => m.content).join("\n"),
    40
  );
  const existingOrdered = sims
    ? [...opts.existingMemories].sort(
        (a, b) => (sims.get(b.id) ?? -1) - (sims.get(a.id) ?? -1)
      )
    : opts.existingMemories;

  const existingMemList = existingOrdered
    .slice(0, 40)
    .map((m) => `[${m.id}] (${m.category}) ${m.content}`)
    .join("\n");
  const existingLoopList = opts.existingLoops
    .filter((l) => l.status === "active")
    .map((l) => `[${l.id}] ${l.description}`)
    .join("\n");

  const out = await model.generateStructured({
    schema: extractionSchema,
    temperature: 0.3,
    messages: [
      { role: "system", content: EXTRACT_PROMPT },
      {
        role: "user",
        content: `EXISTING MEMORIES:\n${existingMemList || "(none)"}\n\nACTIVE OPEN LOOPS:\n${existingLoopList || "(none)"}\n\nLATEST EXCHANGE:\n${exchange.map((m) => `${m.role}: ${m.content}`).join("\n")}`,
      },
    ],
  });

  // ── memories ──────────────────────────────────────────────────────────────
  const { accepted, reinforced } = dedupeNewMemories(
    out.new_memories,
    opts.existingMemories
  );

  if (accepted.length) {
    const { data: inserted } = await supabase
      .from("memories")
      .insert(
        accepted.map((m) => ({
          user_id: userId,
          category: m.category,
          content: m.content,
          importance: m.importance,
          confidence: m.confidence,
          keywords: m.keywords,
          entities: m.entities,
          learned_from_user: m.learned_from_user,
          supporting_memory_ids: m.supporting_memory_ids,
          evidence_count: Math.max(1, m.supporting_memory_ids.length),
          last_referenced_at: new Date().toISOString(),
        }))
      )
      .select("id");

    // Embed on write — semantic recall needs vectors on every row.
    if (inserted?.length) {
      const vecs = await embedTexts(accepted.map((m) => m.content));
      if (vecs) {
        await Promise.all(
          inserted.map((row, i) =>
            vecs[i]
              ? supabase
                  .from("memories")
                  .update({ embedding: vecs[i] })
                  .eq("id", row.id)
              : Promise.resolve()
          )
        );
      }
    }
  }

  if (reinforced.length) {
    await supabase
      .from("memories")
      .update({ last_referenced_at: new Date().toISOString() })
      .in("id", reinforced);
  }

  // ── her episodes — what she told him, deduped against prior episodes ────
  const ep = dedupeNewEpisodes(out.her_episodes, opts.existingMemories);
  if (ep.accepted.length) {
    const { data: epRows } = await supabase
      .from("memories")
      .insert(
        ep.accepted.map((e) => ({
          user_id: userId,
          category: "her_episode",
          content: e.content,
          importance: e.importance,
          confidence: 1.0,
          keywords: e.thread_slug
            ? [...e.keywords, `thread:${e.thread_slug}`]
            : e.keywords,
          entities: e.entities,
        }))
      )
      .select("id");
    if (epRows?.length) {
      const vecs = await embedTexts(ep.accepted.map((e) => e.content));
      if (vecs) {
        await Promise.all(
          epRows.map((row, i) =>
            vecs[i]
              ? supabase
                  .from("memories")
                  .update({ embedding: vecs[i] })
                  .eq("id", row.id)
              : Promise.resolve()
          )
        );
      }
    }
  }
  if (ep.reinforced.length) {
    await supabase
      .from("memories")
      .update({ last_referenced_at: new Date().toISOString() })
      .in("id", ep.reinforced);
  }

  // ── her commitments — dated plans become tomorrow's schedule ────────────
  // Same-day dedupe: "gym tomorrow" said three times is one commitment.
  for (const c of out.her_commitments.slice(0, 3)) {
    const day = resolveDayHint(c.day_hint);
    if (!day) continue;
    const { data: existing } = await supabase
      .from("her_commitments")
      .select("id, content")
      .eq("user_id", userId)
      .eq("target_day", day)
      .eq("consumed", false);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
    if (
      (existing ?? []).some(
        (e: { content: string }) =>
          norm(e.content) === norm(c.content) ||
          norm(e.content).includes(norm(c.content)) ||
          norm(c.content).includes(norm(e.content))
      )
    )
      continue;
    await supabase.from("her_commitments").insert({
      user_id: userId,
      target_day: day,
      content: c.content,
    });
  }

  for (const u of out.memory_updates) {
    const patch: Record<string, unknown> = {};
    if (u.content !== undefined) patch.content = u.content;
    if (u.confidence !== undefined) patch.confidence = u.confidence;
    if (u.importance !== undefined) patch.importance = Math.round(u.importance);
    if (u.status !== undefined) patch.status = u.status;
    if (u.related_memory_ids !== undefined)
      patch.related_memory_ids = u.related_memory_ids;
    if (Object.keys(patch).length)
      await supabase.from("memories").update(patch).eq("id", u.id).eq("user_id", userId);
  }

  // ── open loops ────────────────────────────────────────────────────────────
  let loopChanges = 0;
  for (const l of out.open_loop_updates) {
    if (l.action === "create" && l.description) {
      await supabase.from("open_loops").insert({
        user_id: userId,
        description: l.description,
        importance: Math.round(l.importance ?? 5),
        emotional_weight: Math.round(l.emotional_weight ?? 5),
        due_hint: l.due_hint ?? null,
        related_memory_ids: l.related_memory_ids ?? [],
      });
      loopChanges++;
    } else if (l.id) {
      const statusMap = { resolve: "resolved", cancel: "cancelled", stale: "stale" } as const;
      const status = statusMap[l.action as keyof typeof statusMap];
      if (status) {
        await supabase
          .from("open_loops")
          .update({ status, updated_at: new Date().toISOString() })
          .eq("id", l.id)
          .eq("user_id", userId);
        loopChanges++;
      }
    }
  }

  // ── conversation summary ──────────────────────────────────────────────────
  if (out.conversation_summary) {
    await supabase
      .from("conversation_state")
      .update({ summary: out.conversation_summary })
      .eq("user_id", userId);
  }

  return {
    insertedMemories: accepted.length,
    reinforcedMemories: reinforced.length,
    loopChanges,
    summary: out.conversation_summary,
  };
}
