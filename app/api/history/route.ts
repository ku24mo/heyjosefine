import { NextResponse } from "next/server";
import {
  ensureProfile,
  getOrCreateConversation,
  getRecentMessages,
} from "@/lib/db/queries";
import { currentPresence } from "@/lib/persona/presence";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);
  const conversation = await getOrCreateConversation(supabase, user.id);
  const [messages, presence] = await Promise.all([
    getRecentMessages(supabase, conversation.id, 100),
    currentPresence(supabase, user.id),
  ]);
  return NextResponse.json({
    presence: presence.state,
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      tapback: m.meta?.tapback ?? null,
    })),
  });
}
