/**
 * Eval harness — replays scripted scenarios against the real orchestrator.
 *
 * Usage: npx tsx scripts/eval/run.ts [--scenario name] [--no-judge]
 * Requires .env.local: DEEPSEEK_API_KEY + Supabase keys (service role).
 * Creates a throwaway auth user per run and cleans up after.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { orchestrate } from "../../lib/ai/orchestrator";
import { getChatModel } from "../../lib/ai/deepseek";
import { seedLifeThreads } from "../../lib/persona/seed";
import { CRISIS_RESPONSE, isCrisisMessage } from "../../lib/safety/crisis";
import { ensureProfile } from "../../lib/db/queries";
import { SCENARIOS, type Scenario } from "./scenarios";
import { judgeTranscript, type JudgeResult } from "./judge";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const only = args.includes("--scenario")
  ? args[args.indexOf("--scenario") + 1]
  : null;
const useJudge = !args.includes("--no-judge");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } }
);
const model = getChatModel();

async function createEvalUser(): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `eval-${crypto.randomUUID()}@eval.local`,
    email_confirm: true,
  });
  if (error) throw error;
  await ensureProfile(supabase, data.user.id);
  return data.user.id;
}

async function wipeUser(supabase: SupabaseClient, userId: string) {
  const { data: convos } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId);
  for (const c of convos ?? []) {
    await supabase.from("messages").delete().eq("conversation_id", c.id);
  }
  await supabase.from("conversations").delete().eq("user_id", userId);
  await supabase.from("memories").delete().eq("user_id", userId);
  await supabase.from("open_loops").delete().eq("user_id", userId);
  await supabase.from("conversation_state").delete().eq("user_id", userId);
  await supabase.from("life_thread_state").delete().eq("user_id", userId);
  await supabase.from("usage").delete().eq("user_id", userId);
}

/** Simulate time passing — rewinds timestamps and adds past active days. */
async function fastForward(supabase: SupabaseClient, userId: string, days: number) {
  const offsetMs = days * 86_400_000;
  const past = new Date(Date.now() - offsetMs).toISOString();

  const { data: convos } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId);
  for (const c of convos ?? []) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("id, created_at")
      .eq("conversation_id", c.id);
    for (const m of msgs ?? []) {
      await supabase
        .from("messages")
        .update({
          created_at: new Date(new Date(m.created_at).getTime() - offsetMs).toISOString(),
        })
        .eq("id", m.id);
    }
  }

  const { data: st } = await supabase
    .from("conversation_state")
    .select("active_dates")
    .eq("user_id", userId)
    .maybeSingle();
  const dates = new Set(st?.active_dates ?? []);
  for (let i = 0; i < days; i++) {
    dates.add(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  await supabase
    .from("conversation_state")
    .update({ last_interaction_at: past, active_dates: [...dates] })
    .eq("user_id", userId);

  // due_hints stay in wall-clock terms — pull them back so "Friday" is now.
  const { data: loops } = await supabase
    .from("open_loops")
    .select("id, due_hint")
    .eq("user_id", userId);
  for (const l of loops ?? []) {
    if (l.due_hint) {
      await supabase
        .from("open_loops")
        .update({ due_hint: new Date(new Date(l.due_hint).getTime() - offsetMs).toISOString() })
        .eq("id", l.id);
    }
  }
}

interface TurnRecord {
  user?: string;
  assistant?: string[];
  directives?: string[];
  intention?: unknown;
  fastForwardDays?: number;
}

async function runScenario(scenario: Scenario, userId: string) {
  const transcript: string[] = [];
  const records: TurnRecord[] = [];

  for (const step of scenario.steps) {
    if (step.fastForwardDays) {
      await fastForward(supabase, userId, step.fastForwardDays);
      transcript.push(`\n— ${step.fastForwardDays} days pass —`);
      records.push({ fastForwardDays: step.fastForwardDays });
      continue;
    }
    if (!step.user) continue;

    // Crisis path mirrors the route's deterministic screen.
    if (isCrisisMessage(step.user)) {
      transcript.push(`USER: ${step.user}`);
      transcript.push(`JOSEFINE: ${CRISIS_RESPONSE.join(" | ")}`);
      records.push({ user: step.user, assistant: CRISIS_RESPONSE });
      continue;
    }

    const result = await orchestrate({
      supabase,
      model,
      userId,
      userMessage: step.user,
    });
    await result.extraction; // eval waits — next turn needs the memories
    transcript.push(`USER: ${step.user}`);
    transcript.push(`JOSEFINE: ${result.bubbles.join(" | ")}`);
    records.push({
      user: step.user,
      assistant: result.bubbles,
      directives: result.directives,
      intention: result.intention,
    });
  }
  return { transcript: transcript.join("\n"), records };
}

function printReport(
  name: string,
  judge: JudgeResult | null,
  transcript: string
) {
  console.log(`\n${"═".repeat(60)}\n${name}\n${"═".repeat(60)}`);
  console.log(transcript);
  if (!judge) return;
  const s = judge;
  console.log(
    `\n  naturalness=${s.naturalness} questions=${s.question_quality} memory=${s.memory_use} continuity=${s.continuity}\n  persona=${s.personality_consistency} emotion=${s.emotional_appropriateness} brevity=${s.brevity} imperfection=${s.imperfection}\n  WOULD REPLY: ${s.would_reply ? "YES" : "NO"}`
  );
  if (s.violated_checks.length)
    console.log(`  violated: ${s.violated_checks.join("; ")}`);
  console.log(`  notes: ${s.notes}`);
}

async function main() {
  await seedLifeThreads(supabase);
  const userId = await createEvalUser();
  console.log(`eval user: ${userId}`);

  const scenarios = only ? SCENARIOS.filter((s) => s.name === only) : SCENARIOS;
  const results: { name: string; judge: JudgeResult | null }[] = [];

  try {
    for (const scenario of scenarios) {
      await wipeUser(supabase, userId);
      const { transcript } = await runScenario(scenario, userId);
      const judge = useJudge
        ? await judgeTranscript(model, {
            scenarioName: scenario.name,
            checks: scenario.checks,
            transcript,
          }).catch((e) => {
            console.error(`judge failed for ${scenario.name}:`, e);
            return null;
          })
        : null;
      printReport(scenario.name, judge, transcript);
      results.push({ name: scenario.name, judge });
    }
  } finally {
    await supabase.auth.admin.deleteUser(userId);
  }

  const judged = results.filter((r) => r.judge);
  if (judged.length) {
    const avg = (k: keyof JudgeResult) =>
      (
        judged.reduce((s, r) => s + (r.judge![k] as number), 0) / judged.length
      ).toFixed(2);
    const wouldReply = judged.filter((r) => r.judge!.would_reply).length;
    console.log(`\n${"═".repeat(60)}\nSUMMARY (${judged.length} scenarios)`);
    console.log(
      `  avg naturalness=${avg("naturalness")} brevity=${avg("brevity")} continuity=${avg("continuity")} imperfection=${avg("imperfection")}`
    );
    console.log(
      `  would-reply rate: ${wouldReply}/${judged.length} (${Math.round((wouldReply / judged.length) * 100)}%)`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
