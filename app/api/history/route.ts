import { NextResponse } from "next/server";
import {
  ensureProfile,
  getOrCreateConversation,
  getRecentMessages,
} from "@/lib/db/queries";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);
  const conversation = await getOrCreateConversation(supabase, user.id);
  const messages = await getRecentMessages(supabase, conversation.id, 100);
  return NextResponse.json({
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
    })),
  });
}
