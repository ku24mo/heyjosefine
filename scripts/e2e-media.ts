/**
 * Live check for the media framework: seeds assets + a throwaway user,
 * then exercises pickMedia's gates against the real DB.
 * Requires .env.local (service key). Run: npx tsx scripts/e2e-media.ts
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { pickMedia, recordMediaSend } from "../lib/media/pick";

config({ path: ".env.local" });
const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!
);

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  console.log(`  ${ok ? "✓" : "✗"} ${name}`);
  if (ok) pass++; else fail++;
}

async function main() {
  const email = `media-${Date.now()}@example.com`;
  const { data: created, error } = await service.auth.admin.createUser({
    email,
    password: "TestPass123!",
    email_confirm: true,
  });
  if (error || !created.user) throw new Error(error?.message ?? "no user");
  const uid = created.user.id;

  // backdate: they met 5 days ago
  await service.from("profiles").insert({
    id: uid,
    created_at: new Date(Date.now() - 5 * 86_400_000).toISOString(),
  });

  // seed assets (storage_path is only used to build a URL — no file needed)
  const seeds = [
    { storage_path: "test/odin-d1.jpg", subject: "odin", tags: ["socks"], unlock_day: 1, intimacy_tier: 1 },
    { storage_path: "test/selfie-d10.jpg", subject: "self", tags: ["mirror"], unlock_day: 10, intimacy_tier: 2 },
    { storage_path: "test/comfort-d1.jpg", subject: "scene", tags: ["comfort", "tea"], unlock_day: 1, intimacy_tier: 1 },
    { storage_path: "test/close-d2.jpg", subject: "self", tags: ["bed"], unlock_day: 2, intimacy_tier: 3 },
  ];
  const { data: assets } = await service
    .from("media_assets")
    .insert(seeds)
    .select("id, subject, storage_path");
  const aid = (p: string) => assets!.find((a) => a.storage_path === p)!.id;

  try {
    // 1. day-5 user: d1 assets eligible, d10 not, tier-3 not (stageTier 1)
    const p1 = await pickMedia(service, {
      userId: uid, stageTier: 1, daysKnown: 5, intent: { subject: "odin", scene: null },
    });
    check("day-1 odin asset is eligible on day 5", p1?.asset.subject === "odin");

    const locked = await pickMedia(service, {
      userId: uid, stageTier: 1, daysKnown: 5, intent: { subject: "self", scene: null },
    });
    check("d10 selfie not yet unlocked + tier-3 gated → null", locked === null);

    // 2. ledger: send it → never again
    await recordMediaSend(service, uid, aid("test/odin-d1.jpg"), null);
    const p2 = await pickMedia(service, {
      userId: uid, stageTier: 1, daysKnown: 5, intent: { subject: "odin", scene: null },
    });
    check("sent asset is invisible to that user forever", p2 === null);

    // 3. cooldown + daily cap ride the ledger (just sent → cooldown active)
    const p3 = await pickMedia(service, {
      userId: uid, stageTier: 1, daysKnown: 5, intent: null,
    });
    check("cooldown blocks any send right after", p3 === null);

    // 4. comfort gate: heavy moment → only comfort-tagged assets.
    //    Backdate the send past cooldown so the gate is the only blocker.
    await service.from("media_sends")
      .update({ sent_at: new Date(Date.now() - 10 * 3_600_000).toISOString() })
      .eq("user_id", uid);
    const p4 = await pickMedia(service, {
      userId: uid, stageTier: 1, daysKnown: 5, intent: null, comfortOnly: true,
    });
    check("heavy moment → only comfort assets", p4?.asset.tags.includes("comfort") === true);

    // 5. a different user CAN receive the same asset
    const { data: u2 } = await service.auth.admin.createUser({
      email: `media-b-${Date.now()}@example.com`,
      password: "TestPass123!", email_confirm: true,
    });
    await service.from("profiles").insert({ id: u2!.user!.id, created_at: new Date(Date.now() - 5 * 86_400_000).toISOString() });
    const p5 = await pickMedia(service, {
      userId: u2!.user!.id, stageTier: 1, daysKnown: 5, intent: { subject: "odin", scene: null },
    });
    check("same asset still serves other users", p5?.asset.subject === "odin");

    // 6. unlock-day edge: brand-new user (day 0) sees nothing
    const { data: u3 } = await service.auth.admin.createUser({
      email: `media-c-${Date.now()}@example.com`,
      password: "TestPass123!", email_confirm: true,
    });
    await service.from("profiles").insert({ id: u3!.user!.id });
    const p6 = await pickMedia(service, {
      userId: u3!.user!.id, stageTier: 1, daysKnown: 0, intent: null,
    });
    check("day-0 user: nothing unlocked", p6 === null);

    // cleanup users + assets
    await service.from("media_assets").delete().in("id", assets!.map((a) => a.id));
    for (const u of [uid, u2!.user!.id, u3!.user!.id])
      await service.auth.admin.deleteUser(u);
  } catch (e) {
    console.error("failed mid-run:", e);
    await service.from("media_assets").delete().in("id", (assets ?? []).map((a) => a.id));
    await service.auth.admin.deleteUser(uid);
    process.exit(1);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

void main();
