/** Debug one exchange: what got extracted, what directives fire next turn. */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { getChatModel } from "../lib/ai/deepseek";
import { orchestrate } from "../lib/ai/orchestrator";
import { ensureProfile, getOpenLoops, getActiveMemories } from "../lib/db/queries";
import { getOrCreateState } from "../lib/state/conversation";
import { computeSignals, buildDirectives } from "../lib/ai/rules";
import { HeuristicRetriever } from "../lib/memory/retrieve";

config({ path: ".env.local" });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } }
);
const model = getChatModel();

const msg1 = process.argv[2] ?? "I'm thinking about quitting my job";
const msg2 = process.argv[3] ?? "hey";

async function main() {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `dbg-${crypto.randomUUID()}@eval.local`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  const userId = data.user.id;
  await ensureProfile(supabase, userId);
  console.log("user:", userId);

  const r1 = await orchestrate({ supabase, model, userId, userMessage: msg1 });
  console.log("\nHER:", r1.bubbles.join(" | "));
  console.log("directives:", r1.directives);
  try {
    const er = await r1.extraction;
    console.log("extraction result:", JSON.stringify(er));
  } catch (e) {
    console.log("extraction threw:", e);
  }

  const [mems, loops] = await Promise.all([
    getActiveMemories(supabase, userId),
    getOpenLoops(supabase, userId),
  ]);
  console.log("\nMEMORIES:", mems.map((m) => `(${m.category},i${m.importance},c${m.confidence}) ${m.content}`));
  console.log("LOOPS:", loops.map((l) => `(${l.status},i${l.importance},w${l.emotional_weight}) ${l.description}`));

  // simulate next-turn directives for msg2
  const state = await getOrCreateState(supabase, userId);
  const retrieved = new HeuristicRetriever().retrieve(mems, {
    userMessage: msg2,
    recentEntities: [],
    openLoops: loops,
  });
  console.log("\nRETRIEVED for turn 2:", retrieved.map((r) => `${r.memory.content} (score ${r.score.toFixed(2)}, fuzzy=${r.fuzzy})`));
  const signals = computeSignals({
    userMessage: msg2,
    recentMessages: [],
    memories: retrieved.map((r) => r.memory),
    openLoops: loops,
    state,
  });
  console.log("SIGNALS:", JSON.stringify(signals, null, 1));
  const dirs = buildDirectives(
    { userMessage: msg2, recentMessages: [], memories: retrieved.map((r) => r.memory), openLoops: loops, state },
    signals
  );
  console.log("DIRECTIVES:", dirs.map((d) => `${d.rule}${d.hard ? " [HARD]" : ""}`));

  const r2 = await orchestrate({ supabase, model, userId, userMessage: msg2 });
  await r2.extraction.catch(() => {});
  console.log("\nHER:", r2.bubbles.join(" | "));
  await supabase.auth.admin.deleteUser(userId);
}

main().catch((e) => (console.error(e), process.exit(1)));
