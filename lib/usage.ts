import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";

/** Free-tier usage limits. Exceed → paywall stub. */

export interface UsageStatus {
  allowed: boolean;
  reason?: "daily" | "total";
  usedToday: number;
  usedTotal: number;
  dailyLimit: number;
  totalLimit: number;
}

export async function checkUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<UsageStatus> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("usage")
    .select("date, message_count")
    .eq("user_id", userId);

  const rows = data ?? [];
  const usedToday = rows.find((r) => r.date === today)?.message_count ?? 0;
  const usedTotal = rows.reduce((s, r) => s + r.message_count, 0);

  const { freeDailyLimit, freeTotalLimit } = CONFIG.usage;
  const reason =
    usedTotal >= freeTotalLimit ? "total" : usedToday >= freeDailyLimit ? "daily" : undefined;

  return {
    allowed: reason === undefined,
    reason,
    usedToday,
    usedTotal,
    dailyLimit: freeDailyLimit,
    totalLimit: freeTotalLimit,
  };
}

/**
 * Atomic check+increment — one DB round-trip under the row lock, so a
 * double-submit can't slip past the cap. Denied sends still count (they're
 * attempts), which doubles as abuse protection.
 */
export async function gateUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<UsageStatus> {
  const today = new Date().toISOString().slice(0, 10);
  const { freeDailyLimit, freeTotalLimit } = CONFIG.usage;
  const { data, error } = await supabase.rpc("usage_gate", {
    p_user_id: userId,
    p_date: today,
    p_daily: freeDailyLimit,
    p_total: freeTotalLimit,
  });
  if (error || !data) {
    // RPC missing (old DB) → fall back to non-atomic check; still enforces.
    const s = await checkUsage(supabase, userId);
    if (s.allowed) await incrementUsage(supabase, userId);
    return s;
  }
  return {
    allowed: data.allowed,
    reason: data.reason,
    usedToday: data.usedToday,
    usedTotal: data.usedTotal,
    dailyLimit: freeDailyLimit,
    totalLimit: freeTotalLimit,
  };
}

export async function incrementUsage(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  await supabase.rpc("increment_usage", { p_user_id: userId, p_date: today }).then(
    async ({ error }) => {
      if (error) {
        // fallback: upsert
        const { data } = await supabase
          .from("usage")
          .select("message_count")
          .eq("user_id", userId)
          .eq("date", today)
          .maybeSingle();
        await supabase.from("usage").upsert({
          user_id: userId,
          date: today,
          message_count: (data?.message_count ?? 0) + 1,
        });
      }
    }
  );
}
