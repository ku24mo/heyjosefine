import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";

/**
 * Media send resolution — the model PROPOSES ({subject, scene} intent),
 * this module DISPOSES: eligibility, tier, timeline, cadence, dedupe.
 * The LLM can never name a file; it can only want to share a kind of photo.
 *
 * never-twice is structural: media_sends(user_id, asset_id) PK.
 */

export const MEDIA_BUCKET = "josefine-media";

export interface MediaAsset {
  id: string;
  subject: string;
  tags: string[];
  intimacy_tier: number;
  unlock_day: number;
  storage_path: string;
}

export interface MediaIntent {
  subject?: string | null;
  scene?: string | null;
}

export interface PickedMedia {
  asset: MediaAsset;
  url: string;
}

export function mediaUrl(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storagePath).data
    .publicUrl;
}

/** Pure chooser — the testable core. Assumes assets already pass
 *  unlock_day/tier/not-sent filtering (DB-side). */
export function chooseAsset(
  assets: MediaAsset[],
  opts: {
    intent?: MediaIntent | null;
    comfortOnly?: boolean;
    /** day-plausible subjects get first pick — soft bias, never a filter */
    preferSubjects?: string[];
  }
): MediaAsset | null {
  let pool = assets;
  if (opts.comfortOnly) pool = pool.filter((a) => a.tags.includes("comfort"));
  if (!pool.length) return null;

  const intent = opts.intent;
  if (intent?.subject) {
    // She meant a specific thing — never substitute a random asset for it.
    const subjectHits = pool.filter(
      (a) => a.subject.toLowerCase() === intent.subject!.toLowerCase()
    );
    if (!subjectHits.length) return null;
    pool = subjectHits;
    if (intent.scene) {
      const sceneHits = pool.filter((a) =>
        a.tags.some((t) => t.toLowerCase() === intent.scene!.toLowerCase())
      );
      if (sceneHits.length) pool = sceneHits;
    }
  } else if (opts.preferSubjects?.length) {
    // No specific intent: a photo that's plausible for her day wins.
    const preferred = opts.preferSubjects.map((s) => s.toLowerCase());
    const hits = pool.filter((a) =>
      preferred.includes(a.subject.toLowerCase())
    );
    if (hits.length) pool = hits;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Resolve a media intent (or an open "any photo" slot) for a user.
 * Returns null on any gate failure — callers degrade to plain text.
 */
export async function pickMedia(
  supabase: SupabaseClient,
  opts: {
    userId: string;
    /** disclosure tier from familiarity stage: new=1, warming/familiar=2, close=3 */
    stageTier: number;
    /** days since profiles.created_at — the per-user timeline position */
    daysKnown: number;
    intent?: MediaIntent | null;
    /** true during heavy/emotional moments — only comfort-tagged assets */
    comfortOnly?: boolean;
    /** her-day-plausible subjects get first pick on open-intent sends */
    preferSubjects?: string[];
    now?: Date;
  }
): Promise<PickedMedia | null> {
  const now = opts.now ?? new Date();

  // ── cadence: daily cap + cooldown, measured from the ledger ──
  const { data: sends } = await supabase
    .from("media_sends")
    .select("asset_id, sent_at")
    .eq("user_id", opts.userId)
    .order("sent_at", { ascending: false });

  const rows = sends ?? [];
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const sentToday = rows.filter(
    (r) => new Date(r.sent_at).getTime() >= dayStart.getTime()
  ).length;
  if (sentToday >= CONFIG.media.dailyCap) return null;

  const lastSentAt = rows[0]?.sent_at;
  if (
    lastSentAt &&
    now.getTime() - new Date(lastSentAt).getTime() <
      CONFIG.media.cooldownHours * 3_600_000
  )
    return null;

  // ── eligibility: timeline + intimacy tier + never-sent ──
  const sentIds = new Set(rows.map((r) => r.asset_id as string));
  const { data: assets } = await supabase
    .from("media_assets")
    .select("id, subject, tags, intimacy_tier, unlock_day, storage_path")
    .eq("enabled", true)
    .lte("unlock_day", opts.daysKnown)
    .lte("intimacy_tier", opts.stageTier);

  const eligible = ((assets ?? []) as MediaAsset[]).filter(
    (a) => !sentIds.has(a.id)
  );

  const asset = chooseAsset(eligible, {
    intent: opts.intent,
    comfortOnly: opts.comfortOnly,
    preferSubjects: opts.preferSubjects,
  });
  if (!asset) return null;
  return { asset, url: mediaUrl(supabase, asset.storage_path) };
}

/** Write the ledger row once the media message exists. Fail-soft: a
 *  concurrent same-asset race just loses the PK — the message is already
 *  sent, the conflict only tightens the ledger. */
export async function recordMediaSend(
  supabase: SupabaseClient,
  userId: string,
  assetId: string,
  messageId: string | null
): Promise<void> {
  await supabase
    .from("media_sends")
    .upsert(
      { user_id: userId, asset_id: assetId, message_id: messageId },
      { onConflict: "user_id,asset_id", ignoreDuplicates: true }
    );
}
