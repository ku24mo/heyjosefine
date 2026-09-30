import { NextResponse } from "next/server";
import {
  ensureProfile,
  getOrCreateConversation,
  getRecentMessages,
} from "@/lib/db/queries";
import { currentPresence } from "@/lib/persona/presence";
import { stageForFamiliarity } from "@/lib/persona/profile";
import { getOrCreateState } from "@/lib/state/conversation";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);
  const conversation = await getOrCreateConversation(supabase, user.id);
  const [messages, presence, profile, state, usageRows] = await Promise.all([
    getRecentMessages(supabase, conversation.id, 100),
    currentPresence(supabase, user.id),
    supabase
      .from("profiles")
      .select("plan, subscription_status, created_at")
      .eq("id", user.id)
      .single(),
    getOrCreateState(supabase, user.id),
    supabase.from("usage").select("message_count").eq("user_id", user.id),
  ]);
  const messageTotal = (usageRows.data ?? []).reduce(
    (s, r) => s + (r.message_count ?? 0),
    0
  );
  const knownSince = profile.data?.created_at ?? null;
  const daysKnown = knownSince
    ? Math.floor((Date.now() - new Date(knownSince).getTime()) / 86_400_000)
    : 0;
  return NextResponse.json({
    presence: presence.state,
    relationship: {
      knownSince,
      daysKnown,
      stage: stageForFamiliarity(state.familiarity),
      messageTotal,
    },
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
