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
  const [messages, presence, profile] = await Promise.all([
    getRecentMessages(supabase, conversation.id, 100),
    currentPresence(supabase, user.id),
    supabase
      .from("profiles")
      .select("plan, subscription_status")
      .eq("id", user.id)
      .single(),
  ]);
  return NextResponse.json({
    presence: presence.state,
    plan:
      profile.data?.plan === "unlimited" &&
      (profile.data.subscription_status === "active" ||
        profile.data.subscription_status === "trialing")
        ? "unlimited"
        : "free",
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      created_at: m.created_at,
      tapback: m.meta?.tapback ?? null,
    })),
  });
}
