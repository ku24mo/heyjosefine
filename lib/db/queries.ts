import type { SupabaseClient } from "@supabase/supabase-js";
import type {
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
  const { data } = await supabase
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
  if (error) throw error;
  return created;
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
