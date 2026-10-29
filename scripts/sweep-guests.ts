/**
 * One-time sweep of stale anonymous guest accounts.
 *
 *   npx tsx scripts/sweep-guests.ts --dry-run          # counts only, nothing deleted
 *   npx tsx scripts/sweep-guests.ts                    # delete guests idle >30 days
 *   npx tsx scripts/sweep-guests.ts --days 14          # custom idle window
 *
 * Stale = auth user is_anonymous AND (no conversation_state row OR
 * last_interaction_at older than the cutoff). Deleting the auth user cascades
 * profiles → conversations → messages → memories → usage → state.
 * Claimed (email) users are never candidates — the anonymous flag is the guard.
 * Re-runnable: deleted users just aren't in the next listUsers page.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";

config({ path: ".env.local" });

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const daysIdx = args.indexOf("--days");
const DAYS = daysIdx >= 0 ? Number(args[daysIdx + 1]) : 30;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const CONCURRENCY = 5;

async function main() {
  const cutoff = new Date(Date.now() - DAYS * 86_400_000);
  console.log(`sweep-guests ${DRY_RUN ? "(dry run) " : ""}— idle > ${DAYS}d (before ${cutoff.toISOString().slice(0, 10)})`);

  // Page through every auth user.
  const anon: { id: string; created_at: string }[] = [];
  let claimed = 0;
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.is_anonymous) anon.push({ id: u.id, created_at: u.created_at });
      else claimed++;
    }
    if (users.length < 1000) break;
  }
  console.log(`auth users: ${anon.length} anonymous, ${claimed} claimed`);

  // Last-interaction map for all anon users (one query, not per-user).
  const lastSeen = new Map<string, string | null>();
  {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from("conversation_state")
        .select("user_id, last_interaction_at")
        .range(from, from + 999);
      if (error) throw error;
      for (const r of data ?? [])
        lastSeen.set(r.user_id, r.last_interaction_at);
      if ((data ?? []).length < 1000) break;
      from += 1000;
    }
  }

  const stale = anon.filter((u) => {
    if (u.created_at > cutoff.toISOString()) return false; // young account, keep
    const last = lastSeen.get(u.id);
    return !last || new Date(last) < cutoff;
  });

  // Age buckets for the dry-run readout.
  const buckets = new Map<string, number>();
  for (const u of stale) {
    const age = Math.floor(
      (Date.now() - new Date(u.created_at).getTime()) / 86_400_000
    );
    const b = age > 60 ? "60d+" : age > 30 ? "30–60d" : `${DAYS}–30d`;
    buckets.set(b, (buckets.get(b) ?? 0) + 1);
  }
  console.log(`stale guests: ${stale.length}`, Object.fromEntries(buckets));

  if (DRY_RUN || !stale.length) {
    if (!stale.length) console.log("nothing to delete.");
    return;
  }

  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < stale.length; i += CONCURRENCY) {
    await Promise.all(
      stale.slice(i, i + CONCURRENCY).map(async (u) => {
        const { error } = await supabase.auth.admin.deleteUser(u.id);
        if (error) {
          failed++;
          console.error(`  delete failed ${u.id}: ${error.message}`);
        } else deleted++;
      })
    );
    if ((i / CONCURRENCY) % 20 === 0)
      console.log(`  progress ${i + 1}/${stale.length}…`);
  }
  console.log(`done — deleted ${deleted}, failed ${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
