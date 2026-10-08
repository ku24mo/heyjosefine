import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";

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
  /** Fresh signed URL — expires in ~1h; re-sign on history reads. */
  url: string;
}

/**
 * Sign a library asset for delivery — service role only. The bucket is
 * private (0016): public URLs and self-minted signed URLs both 403, so a
 * dumped storage_path is worthless without the app signing it.
 */
export async function signMediaPath(storagePath: string): Promise<string | null> {
  const { data } = await createServiceSupabase()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrl(storagePath, 3600);
  return data?.signedUrl ?? null;
}

/** Extract the storage path from a legacy public or signed URL (pre-0016 rows). */
export function mediaPathFromUrl(url: string): string | null {
  const m = url.match(/\/josefine-media\/([^?]+)/);
  return m ? decodeURIComponent(m[1]) : null;
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
  // media_assets is service-read (0016): a session sees only assets it was
  // already sent — the candidate pool must be read with the service client.
  const sentIds = new Set(rows.map((r) => r.asset_id as string));
  const service = createServiceSupabase();
  const { data: assets } = await service
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
  const url = await signMediaPath(asset.storage_path);
  if (!url) return null;
  return { asset, url };
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
