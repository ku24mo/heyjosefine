/**
 * Load test — N concurrent users each send M messages through the real
 * orchestrator + turn lock, against the live DB.
 *
 * Usage:
 *   npx tsx scripts/load-test.ts                  # 20 users × 3 msgs, real LLM
 *   npx tsx scripts/load-test.ts --users 50 --msgs 5 --concurrency 50
 *   npx tsx scripts/load-test.ts --mock           # fake model — DB/lock load only
 *   npx tsx scripts/load-test.ts --keep           # don't delete test users
 *
 * Requires .env.local: Supabase service key (+ DEEPSEEK_API_KEY unless --mock).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { orchestrate } from "../lib/ai/orchestrator";
import { getChatModel } from "../lib/ai/deepseek";
import type { ChatModel } from "../lib/ai/provider";
import {
  extractionSchema,
  openingSchema,
  responseSchema,
} from "../lib/ai/schemas";
import { ensureProfile } from "../lib/db/queries";
import { seedLifeThreads } from "../lib/persona/seed";
import {
  acquireTurnLock,
  getOrCreateState,
  releaseTurnLock,
} from "../lib/state/conversation";

config({ path: ".env.local" });

const arg = (name: string, dflt: number) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};
const USERS = arg("--users", 20);
const MSGS = arg("--msgs", 3);
const CONCURRENCY = arg("--concurrency", USERS);
const MOCK = process.argv.includes("--mock");
const KEEP = process.argv.includes("--keep");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } }
);

/** No-LLM model — isolates DB/lock contention from provider rate limits. */
const mockModel: ChatModel = {
  name: "mock",
  async generateText() {
    return "hey";
  },
  async generateStructured({ schema }) {
    const s = schema as unknown;
    if (s === responseSchema)
      return {
        plan: {
          user_intent: "load test",
          user_emotion: null,
          move: "chat",
          memory_ids_used: [],
          beat_transition: null,
          wants_to_mention_life_thread: null,
        },
        bubbles: ["hey"],
        tapback: null,
      } as never;
    if (s === extractionSchema)
      return {
        conversation_summary: "load test",
        new_memories: [],
        memory_updates: [],
        open_loop_updates: [],
      } as never;
    if (s === openingSchema) return { bubbles: ["hey"] } as never;
    throw new Error("mock: unknown schema");
  },
};
const model: ChatModel = MOCK ? mockModel : getChatModel();

const SAMPLE_MSGS = [
  "hey how's your day going",
  "just finished a long shift, finally home",
  "what are you up to tonight",
  "lol that's fair",
  "tell me something about yourself",
];

async function createUser(): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `load-${crypto.randomUUID()}@load.local`,
    email_confirm: true,
  });
  if (error) throw error;
  await ensureProfile(supabase, data.user.id);
  await getOrCreateState(supabase, data.user.id); // lock row must exist
  return data.user.id;
}

interface TurnResult {
  ok: boolean;
  ms: number;
  err?: string;
}

/** Mirrors the route: usage+burst gate skipped (service role), lock is real. */
async function sendTurn(userId: string, message: string): Promise<TurnResult> {
  const t0 = Date.now();
  try {
    const locked = await acquireTurnLock(supabase, userId, { waitMs: 30_000 });
    if (!locked) return { ok: false, ms: Date.now() - t0, err: "lock timeout" };
    try {
      const result = await orchestrate({ supabase, model, userId, userMessage: message });
      await result.extraction; // route holds the lock through extraction too
      return { ok: true, ms: Date.now() - t0 };
    } finally {
      await releaseTurnLock(supabase, userId);
    }
  } catch (e) {
    return { ok: false, ms: Date.now() - t0, err: String(e) };
  }
}

async function verifyUser(supabase: SupabaseClient, userId: string) {
  const issues: string[] = [];
  const { count: activeConvos } = await supabase
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true)
    .then((r) =>
      // Pre-0007 column missing — count all conversations instead.
      r.error
        ? supabase
            .from("conversations")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId)
        : r
    );
  if (activeConvos !== 1) issues.push(`active conversations: ${activeConvos}`);

  const { data: st } = await supabase
    .from("conversation_state")
    .select("turn_locked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (st?.turn_locked_at) issues.push("lock still held");
  return issues;
}

const pct = (xs: number[], p: number) =>
  xs.length ? xs.sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] : 0;

async function main() {
  console.log(
    `load test: ${USERS} users × ${MSGS} msgs, concurrency ${CONCURRENCY}, model=${model.name}`
  );
  await seedLifeThreads(supabase);

  const t0 = Date.now();
  const userIds: string[] = [];
  // Auth admin creates serially-ish are slow — batch them.
  for (let i = 0; i < USERS; i += 10) {
    userIds.push(
      ...(await Promise.all(
        Array.from({ length: Math.min(10, USERS - i) }, createUser)
      ))
    );
  }
  console.log(`created ${userIds.length} users in ${Date.now() - t0}ms`);

  const results: TurnResult[] = [];
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= userIds.length) return;
      const userId = userIds[i];
      for (let m = 0; m < MSGS; m++) {
        results.push(await sendTurn(userId, SAMPLE_MSGS[m % SAMPLE_MSGS.length]));
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const ok = results.filter((r) => r.ok).map((r) => r.ms);
  const errs = results.filter((r) => !r.ok);
  console.log(`\n${"═".repeat(50)}\nRESULTS (${results.length} turns, ${Date.now() - t0}ms total)`);
  console.log(`  ok=${ok.length} errors=${errs.length}`);
  console.log(
    `  p50=${pct(ok, 50)}ms p95=${pct(ok, 95)}ms p99=${pct(ok, 99)}ms max=${Math.max(...ok, 0)}ms`
  );
  for (const e of errs.slice(0, 10)) console.log(`  err: ${e.err}`);

  // Invariants
  let clean = 0;
  for (const userId of userIds) {
    const issues = await verifyUser(supabase, userId);
    if (issues.length) console.log(`  ${userId}: ${issues.join(", ")}`);
    else clean++;
  }
  console.log(`  invariants clean: ${clean}/${userIds.length} users`);

  if (!KEEP) {
    for (let i = 0; i < userIds.length; i += 10) {
      await Promise.all(
        userIds.slice(i, i + 10).map((id) => supabase.auth.admin.deleteUser(id))
      );
    }
    console.log("cleaned up test users");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
