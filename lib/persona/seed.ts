import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLifeThreadSeeds } from "./life";

/**
 * Seed life_threads from lib/persona/life/*.md — idempotent (upsert by slug).
 * Called by scripts/seed-life.ts and lazily by the opening engine when the
 * table is empty, so a fresh deploy works without a manual step.
 */
export async function seedLifeThreads(supabase: SupabaseClient) {
  const seeds = await loadLifeThreadSeeds();
  const rows = seeds.map((s) => ({
    slug: s.slug,
    title: s.title,
    status: s.status,
    emotional_impact: s.emotional_impact ?? null,
    disclosure_tier: s.disclosure_tier,
    she_wants_to_talk: s.she_wants_to_talk,
    can_open: s.can_open,
    timeline: s.timeline ?? [],
    body: s.body,
    seeded_at: new Date().toISOString(),
  }));
  const { error } = await supabase
    .from("life_threads")
    .upsert(rows, { onConflict: "slug" });
  return { count: rows.length, error };
}
