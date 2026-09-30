import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });
const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function main() {
  const g = await fetch(`${BASE}/api/auth/guest`, { method: "POST" });
  if (!g.ok) throw new Error(`guest: ${g.status} ${await g.text()}`);
  const jar = new Map<string, string>();
  for (const c of g.headers.getSetCookie()) {
    const [p] = c.split(";"); const i = p.indexOf("=");
    jar.set(p.slice(0, i).trim(), p.slice(i + 1).trim());
  }
  const cookie = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const ref = new URL(URL_).hostname.split(".")[0];
  const raw = [...jar.entries()].filter(([k]) => k.startsWith(`sb-${ref}-auth-token`)).sort().map(([, v]) => v).join("");
  const sess = JSON.parse(Buffer.from(raw.replace(/^base64-/, ""), "base64url").toString());
  const { data: u } = await createClient(URL_, ANON).auth.getUser(sess.access_token);
  const uid = u.user!.id;

  for (const q of ["what car do you drive?", "do you live alone?", "where does odin stay?"]) {
    const r = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ message: q }),
    });
    const j = await r.json();
    console.log(`him: ${q}\nher: ${(j.bubbles ?? [JSON.stringify(j)]).join(" | ")}\n`);
  }
  await service.auth.admin.deleteUser(uid);
}
main();
