/**
 * Live check for post-goodnight groggy mode.
 * Seeds a conversation where she already said goodnight, then sends a few
 * more user messages and verifies replies stay short and DON'T re-announce
 * leaving. Requires dev server + .env.local.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const service = createClient(URL_, SERVICE);

async function main() {
  // 1. guest
  const jar = new Map<string, string>();
  const g = await fetch(`${BASE}/api/auth/guest`, { method: "POST" });
  if (!g.ok) throw new Error(`guest failed: ${g.status} ${await g.text()}`);
  for (const c of g.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
  const ref = new URL(URL_).hostname.split(".")[0];
  const raw = [...jar.entries()]
    .filter(([k]) => k === `sb-${ref}-auth-token` || k.startsWith(`sb-${ref}-auth-token.`))
    .sort(([a], [b]) => (a.split(".")[1] ?? "0").localeCompare(b.split(".")[1] ?? "0", undefined, { numeric: true }))
    .map(([, v]) => v)
    .join("");
  const sess = JSON.parse(Buffer.from(raw.slice(7), "base64url").toString());
  const { data: u } = await createClient(URL_, ANON).auth.getUser(sess.access_token);
  const uid = u.user!.id;
  console.log("guest:", uid, "| her time is deep-night right now\n");

  // 2. seed a post-goodnight conversation (~30 min ago she said night)
  const { error: profErr } = await service.from("profiles").insert({ id: uid });
  if (profErr) console.log("profile seed:", profErr.message);
  const { data: convo, error: convErr } = await service
    .from("conversations")
    .insert({ user_id: uid })
    .select()
    .single();
  if (!convo) throw new Error(`convo insert failed: ${convErr?.message}`);
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
  const seed: { role: string; content: string; created_at: string }[] = [
    { role: "user", content: "you still up?", created_at: ago(60) },
    { role: "assistant", content: "barely lol. it's like 1am", created_at: ago(59) },
    { role: "user", content: "what are you doing tomorrow", created_at: ago(50) },
    { role: "assistant", content: "8am seminar. which is exactly why I need to sleep", created_at: ago(49) },
    { role: "assistant", content: "okay I'm actually going now. goodnight 😴", created_at: ago(45) },
    { role: "user", content: "just 10 more minutes", created_at: ago(40) },
    { role: "assistant", content: "ugh fine. 10 minutes", created_at: ago(39) },
  ];
  for (const m of seed)
    await service.from("messages").insert({ conversation_id: convo.id, ...m });
  await service.from("conversations").update({ last_message_at: ago(39) }).eq("id", convo.id);

  // 3. send 3 messages — replies should be short, groggy, NO re-declared goodnight
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  let fails = 0;
  for (const text of ["so what are you wearing to bed", "tell me a secret then", "you can't sleep either can you"]) {
    const res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: text }),
    });
    const j = (await res.json()) as { bubbles?: string[] };
    const joined = (j.bubbles ?? []).join(" | ");
    const reDeclared = /good ?night|going (now|to bed)|really (going|this time)|gtg|heading to bed/i.test(joined);
    if (reDeclared) fails++;
    console.log(`him: ${text}\nher: ${joined}   ${reDeclared ? "  ← RE-DECLARED ✗" : "✓"}\n`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // cleanup
  await service.auth.admin.deleteUser(uid);
  console.log(fails === 0 ? "PASS — no re-declared exits" : `FAIL — ${fails} re-declared exit(s)`);
  process.exit(fails ? 1 : 0);
}

main();
