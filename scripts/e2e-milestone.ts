/**
 * Live check for milestone openers. Creates a throwaway user whose profile
 * is backdated ~30 days, seeds an old conversation, then calls
 * generateOpening twice — expecting a milestone opener once, never twice.
 * Requires .env.local (service key + model key).
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { generateOpening } from "../lib/ai/opening";
import { getChatModel } from "../lib/ai/deepseek";

config({ path: ".env.local" });
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const email = `milestone-${Date.now()}@example.com`;
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: "TestPass123!",
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(error?.message ?? "no user");
  const uid = created.user.id;

  try {
    // backdate: profile created 30 days ago, celebrated up to day 14
    await service.from("profiles").insert({
      id: uid,
      created_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });
    const { data: convo } = await service
      .from("conversations")
      .insert({ user_id: uid, last_message_at: new Date(Date.now() - 20 * 3_600_000).toISOString() })
      .select()
      .single();
    await service.from("messages").insert([
      { conversation_id: convo!.id, role: "assistant", content: "talk tomorrow?", created_at: new Date(Date.now() - 20 * 3_600_000).toISOString() },
      { conversation_id: convo!.id, role: "user", content: "night!", created_at: new Date(Date.now() - 19.9 * 3_600_000).toISOString() },
    ]);
    await service.from("conversation_state").insert({
      user_id: uid,
      last_milestone_day: 14,
      familiarity: 40,
      stage: "warming",
      summary: "they chat most evenings; he's warm and playful",
      first_met_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    });

    console.log("call 1 — expecting milestone opener:");
    const o1 = await generateOpening({ supabase: service, model: getChatModel(), userId: uid });
    console.log("  strategy:", o1?.strategy, "| reason:", o1?.reason);
    console.log("  bubbles:", o1?.bubbles.join(" | "));

    const { data: st } = await service
      .from("conversation_state")
      .select("last_milestone_day")
      .eq("user_id", uid)
      .single();
    console.log("  last_milestone_day →", st?.last_milestone_day);

    // second call: last assistant msg isn't there (we didn't persist bubbles),
    // but last_milestone_day=30 should block another milestone anyway
    const o2 = await generateOpening({ supabase: service, model: getChatModel(), userId: uid });
    console.log("\ncall 2 — strategy:", o2?.strategy, "(milestone must not re-fire)");
    const ok = o1?.strategy === "milestone" && st?.last_milestone_day === 30 && o2?.strategy !== "milestone";
    console.log(ok ? "\nPASS" : "\nFAIL");
    process.exitCode = ok ? 0 : 1;
  } finally {
    await service.auth.admin.deleteUser(uid);
  }
}

main();
