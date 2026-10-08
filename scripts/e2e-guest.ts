/**
 * End-to-end smoke test for the anonymous-first funnel.
 *
 * Exercises the REAL HTTP surface of a running dev server:
 *   guest session → opening/chat → billing guards → claim wall →
 *   email/password claim → usage reset → claimed tier → cleanup.
 *
 * Usage:  npx tsx scripts/e2e-guest.ts
 * Requires: dev server on NEXT_PUBLIC_APP_URL (default localhost:3000),
 *           .env.local keys, anonymous sign-ins + manual linking enabled.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const BASE = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const REF = new URL(URL_).hostname.split(".")[0];
const COOKIE = `sb-${REF}-auth-token`;

const service = createClient(URL_, SERVICE);
let passed = 0,
  failed = 0;

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

// ── cookie helpers ──────────────────────────────────────────────────────────
const jar = new Map<string, string>();
function collect(res: Response) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}
function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}
function decodeSession(): { access_token: string; refresh_token: string } {
  // @supabase/ssr may chunk the cookie into .0/.1/… — reassemble in order.
  const parts = [...jar.keys()]
    .filter((k) => k === COOKIE || k.startsWith(`${COOKIE}.`))
    .sort((a, b) => (a.split(".")[1] ?? "0").localeCompare(b.split(".")[1] ?? "0", undefined, { numeric: true }));
  const raw = parts.map((k) => jar.get(k)!).join("");
  const b64 = raw.startsWith("base64-") ? raw.slice(7) : raw;
  return JSON.parse(Buffer.from(b64, "base64url").toString());
}
function storeSession(session: { access_token: string; refresh_token: string }) {
  // Re-encode a full session the way @supabase/ssr expects.
  const json = `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
  // split into ~3180-char chunks like the library does
  const chunks = json.match(/.{1,3180}/g) ?? [json];
  for (const k of [...jar.keys()]) if (k === COOKIE || k.startsWith(`${COOKIE}.`)) jar.delete(k);
  chunks.forEach((c, i) => jar.set(chunks.length > 1 ? `${COOKIE}.${i}` : COOKIE, c));
}
async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { cookie: cookieHeader(), ...(init.headers ?? {}) },
    redirect: "manual",
  });
  collect(res);
  return res;
}
async function chat(text: string) {
  return api("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: text }),
  });
}

// ── run ─────────────────────────────────────────────────────────────────────
async function main() {
console.log(`\nE2E guest funnel → ${BASE}\n`);

// 1. guest creation
const g = await api("/api/auth/guest", { method: "POST" });
check("POST /api/auth/guest → 200", g.status === 200, `got ${g.status} ${JSON.stringify(await g.clone().json().catch(() => null))}`);
check("session cookie set", [...jar.keys()].some((k) => k === COOKIE || k.startsWith(`${COOKIE}.`)));

const sess = decodeSession();
const authed = createClient(URL_, ANON);
const { data: u } = await authed.auth.getUser(sess.access_token);
check("user is anonymous", u.user?.is_anonymous === true, JSON.stringify(u.user?.is_anonymous));
const uid = u.user!.id;

// 2. authenticated surface
const hist = await api("/api/history");
check("GET /api/history → 200 as guest", hist.status === 200, `got ${hist.status}`);

const open = await api("/api/opening");
const openJson = (await open.json().catch(() => ({}))) as { bubbles?: string[] };
check("GET /api/opening → 200 with first-hello bubbles", open.status === 200 && (openJson.bubbles?.length ?? 0) > 0, `got ${open.status} ${JSON.stringify(openJson).slice(0, 200)}`);
if (openJson.bubbles?.length) console.log(`    opening: ${openJson.bubbles.join(" | ").slice(0, 140)}`);

// 3. guest can chat
const c1 = await chat("hey, who's this?");
const c1j = (await c1.json().catch(() => ({}))) as { bubbles?: string[] };
check("guest chat → 200 bubbles", c1.status === 200 && Array.isArray(c1j.bubbles), `got ${c1.status} ${JSON.stringify(c1j).slice(0, 200)}`);

// 4. billing guards
const co = await api("/api/checkout", { method: "POST" });
check("checkout blocked for guest (403)", co.status === 403, `got ${co.status}`);
const bp = await api("/api/billing-portal", { method: "POST" });
check("billing-portal blocked for guest (403)", bp.status === 403, `got ${bp.status}`);

// 5. anon can still view /auth (proxy must not bounce them)
const authPage = await api("/auth");
check("guest can view /auth (not redirected)", authPage.status === 200, `got ${authPage.status}`);

// 6. force the claim wall: seed usage to the guest cap
await service.from("usage").upsert({ user_id: uid, date: new Date().toISOString().slice(0, 10), message_count: 30 });
const c2 = await chat("one more");
const c2j = (await c2.json().catch(() => ({}))) as { claim?: boolean };
check("over guest cap → 403 + claim:true", c2.status === 403 && c2j.claim === true, `got ${c2.status} ${JSON.stringify(c2j).slice(0, 200)}`);

// 7. claim: same flow as claim-sheet (setSession from cookie, then updateUser)
const claimClient = createClient(URL_, ANON, { auth: { persistSession: false } });
await claimClient.auth.setSession(sess);
const email = `e2e-${Date.now()}@example.com`;
const { data: claimed, error: claimErr } = await claimClient.auth.updateUser({ email, password: "TestPass123!" });
check("updateUser claim succeeds", !claimErr, claimErr?.message ?? "");
check("user_id preserved (data carries)", claimed?.user?.id === uid, `${claimed?.user?.id} vs ${uid}`);
// Confirm-email on: the user stays anonymous until the link is tapped —
// simulate the tap via the admin API (no mailbox in a script).
if (claimed?.user?.is_anonymous) {
  const { error: confErr } = await service.auth.admin.updateUserById(uid, {
    email,
    email_confirm: true,
  });
  check("admin email_confirm simulates the tap", !confErr, confErr?.message ?? "");
}
const { data: postConfirm } = await service.auth.admin.getUserById(uid);
check("user no longer anonymous", postConfirm?.user?.is_anonymous === false, `is_anonymous=${postConfirm?.user?.is_anonymous}`);
check("email bound", postConfirm?.user?.email === email, `email=${postConfirm?.user?.email}`);

// 8. claimed-session cookies: get a fresh real session via password login
const loginClient = createClient(URL_, ANON, { auth: { persistSession: false } });
const { data: login, error: loginErr } = await loginClient.auth.signInWithPassword({ email, password: "TestPass123!" });
check("password login works post-claim", !loginErr && Boolean(login.session), loginErr?.message ?? "");
if (login.session) storeSession(login.session);

// 9. /api/auth/claimed wipes guest usage
const cl = await api("/api/auth/claimed", { method: "POST" });
check("POST /api/auth/claimed → 200", cl.status === 200, `got ${cl.status}`);
const { data: usageRows } = await service.from("usage").select("message_count").eq("user_id", uid);
check("guest usage wiped", (usageRows?.length ?? -1) === 0, JSON.stringify(usageRows));

// 10. claimed free tier works again
const c3 = await chat("it's me, back again");
check("claimed chat → 200", c3.status === 200, `got ${c3.status}`);

// 11. claimed user bounced off /auth
const authPage2 = await api("/auth");
check("claimed user redirected from /auth", [301, 302, 303, 307, 308].includes(authPage2.status), `got ${authPage2.status}`);

// 12. account delete route exists and works for claimed user
const del = await api("/api/account/delete", { method: "POST" });
check("account delete → 200", del.status === 200, `got ${del.status} ${JSON.stringify(await del.clone().json().catch(() => null))}`);
const { data: ghost } = await service.from("profiles").select("id").eq("id", uid);
check("profile row gone (cascade)", (ghost?.length ?? -1) === 0, JSON.stringify(ghost));
const { data: authGhost } = await service.auth.admin.getUserById(uid).catch(() => ({ data: null }));
check("auth user deleted", !(authGhost as { user?: unknown } | null)?.user, "still exists");

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
}

main();
