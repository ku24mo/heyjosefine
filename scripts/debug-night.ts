/** Debug: deep-night turn — she should still answer, but tired. */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { getChatModel } from "../lib/ai/deepseek";
import { orchestrate } from "../lib/ai/orchestrator";
import { ensureProfile } from "../lib/db/queries";
import { herNow } from "../lib/time";

config({ path: ".env.local" });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } }
);
const model = getChatModel();

const msg = process.argv[2] ?? "can't sleep, tell me something good";
const atHour = Number(process.argv[3] ?? "3"); // Stockholm hour to simulate

async function main() {
  const { data, error } = await supabase.auth.admin.createUser({
    email: `dbg-${crypto.randomUUID()}@eval.local`,
    email_confirm: true,
  });
  if (error || !data.user) throw error ?? new Error("no user");
  const userId = data.user.id;
  await ensureProfile(supabase, userId);

  const now = new Date();
  const cur = herNow(now).hour;
  const at = new Date(now.getTime() + (atHour - cur) * 3_600_000);
  console.log("simulating", herNow(at).time, "Stockholm");

  const r = await orchestrate({ supabase, model, userId, userMessage: msg, now: at });
  console.log("\nHER:", r.bubbles.join(" | "));
  console.log("presence:", r.presence, "| replyDelayMs:", r.replyDelayMs);
  console.log("directives:", r.directives);
  await r.extraction.catch(() => {});
  await supabase.auth.admin.deleteUser(userId);
}
main().catch((e) => (console.error(e), process.exit(1)));
