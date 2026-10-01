import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import type {
  HerRequestRow,
  LifeThreadRow,
  LifeThreadStateRow,
  MemoryRow,
  MessageRow,
  OpenLoopRow,
} from "@/lib/types";

export async function ensureProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();
  if (!data) {
    await supabase.from("profiles").insert({ id: userId });
  }
}

export async function getOrCreateConversation(
  supabase: SupabaseClient,
  userId: string
) {
  // Active thread = latest that isn't retired by a reset. Pre-migration the
  // is_active column doesn't exist — fall back to "latest conversation"
  // only when the filtered query errors, never on an empty result.
  const active = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data } = !active.error
    ? active
    : await supabase
        .from("conversations")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
  if (data) return data;

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId })
    .select()
    .single();
  if (!error) return created;
  // Unique-violation → another request won the create race; take theirs.
  const { data: winner } = await supabase
    .from("conversations")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (winner) return winner;
  throw error;
}

export async function getRecentMessages(
  supabase: SupabaseClient,
  conversationId: string,
  limit = 24
): Promise<MessageRow[]> {
  const { data } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return ((data ?? []) as MessageRow[]).reverse();
}

export async function getActiveMemories(
  supabase: SupabaseClient,
  userId: string
): Promise<MemoryRow[]> {
  const { data } = await supabase
    .from("memories")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("importance", { ascending: false })
    .limit(200);
  return (data ?? []) as MemoryRow[];
}

export async function getOpenLoops(
  supabase: SupabaseClient,
  userId: string
): Promise<OpenLoopRow[]> {
  const { data } = await supabase
    .from("open_loops")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as OpenLoopRow[];
}

export async function getLifeThreads(
  supabase: SupabaseClient,
  maxTier: number
): Promise<LifeThreadRow[]> {
  const { data } = await supabase
    .from("life_threads")
    .select("*")
    .lte("disclosure_tier", maxTier)
    .neq("status", "resolved")
    .order("seeded_at", { ascending: false })
    .limit(10);
  return (data ?? []) as LifeThreadRow[];
}

/**
 * Her queue — requests he's made that she took on (or declined). Active rows
 * plus terminal ones still inside the callback window; declines never expire
 * from context (a "no" stays a "no").
 */
export async function getHerRequests(
  supabase: SupabaseClient,
  userId: string
): Promise<HerRequestRow[]> {
  const cutoff = new Date(
    Date.now() - CONFIG.requests.reportableWindowDays * 86_400_000
  ).toISOString();
  const { data } = await supabase
    .from("her_requests")
    .select("*")
    .eq("user_id", userId)
    .or(`status.eq.doing,status.eq.declined,updated_at.gte.${cutoff}`)
    .order("created_at", { ascending: false })
    .limit(10);
  return (data ?? []) as HerRequestRow[];
}

export async function getLifeThreadStates(
  supabase: SupabaseClient,
  userId: string
): Promise<LifeThreadStateRow[]> {
  const { data } = await supabase
    .from("life_thread_state")
    .select("*")
    .eq("user_id", userId);
  return (data ?? []) as LifeThreadStateRow[];
}

export async function insertMessage(
  supabase: SupabaseClient,
  msg: {
    conversation_id: string;
    role: "user" | "assistant";
    content: string;
    meta?: Record<string, unknown>;
  }
): Promise<MessageRow> {
  const { data, error } = await supabase
    .from("messages")
    .insert({ ...msg, meta: msg.meta ?? {} })
    .select()
    .single();
  if (error) throw error;
  return data as MessageRow;
}
