import { after, NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { orchestrate } from "@/lib/ai/orchestrator";
import {
  ensureProfile,
  getOrCreateConversation,
  insertMessage,
} from "@/lib/db/queries";
import { CRISIS_RESPONSE, isCrisisMessage } from "@/lib/safety/crisis";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkUsage, incrementUsage } from "@/lib/usage";

export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 4000) {
    return NextResponse.json({ error: "bad message" }, { status: 400 });
  }

  await ensureProfile(supabase, user.id);
  const usage = await checkUsage(supabase, user.id);
  if (!usage.allowed) {
    return NextResponse.json({ paywall: true, usage }, { status: 402 });
  }

  // Crisis screen — responds in-voice but with real-world resources,
  // before the model sees it. Still logged + counted.
  if (isCrisisMessage(message)) {
    await incrementUsage(supabase, user.id);
    return NextResponse.json({ bubbles: CRISIS_RESPONSE, crisis: true });
  }

  const model = getChatModel();
  try {
    const result = await orchestrate({
      supabase,
      model,
      userId: user.id,
      userMessage: message,
    });
    await incrementUsage(supabase, user.id);
    after(async () => {
      await result.extraction;
    });
    return NextResponse.json({
      bubbles: result.bubbles,
      messageIds: result.assistantMessages.map((m) => m.id),
      asleep: result.asleep,
      replyDelayMs: result.replyDelayMs,
    });
  } catch (err) {
    console.error("[/api/chat] orchestration failed:", err);
    // Persist their message — she "read it and zoned out", so the next turn
    // still has the context even though the reply degraded.
    try {
      const conversation = await getOrCreateConversation(supabase, user.id);
      await insertMessage(supabase, {
        conversation_id: conversation.id,
        role: "user",
        content: message,
      });
    } catch (e) {
      console.error("[/api/chat] failed to persist degraded user msg:", e);
    }
    // Graceful degradation — a human-ish shrug beats a 500 in the UI.
    return NextResponse.json({
      bubbles: ["sorry, I completely zoned out 😅 what were you saying?"],
      degraded: true,
    });
  }
}
