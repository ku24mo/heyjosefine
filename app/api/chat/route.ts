import { after, NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { orchestrate } from "@/lib/ai/orchestrator";
import {
  ensureProfile,
  getOrCreateConversation,
  insertMessage,
} from "@/lib/db/queries";
import { CRISIS_RESPONSE, isCrisisMessage } from "@/lib/safety/crisis";
import {
  acquireTurnLock,
  getOrCreateState,
  releaseTurnLock,
} from "@/lib/state/conversation";
import { createServerSupabase } from "@/lib/supabase/server";
import { gateUsage } from "@/lib/usage";

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
  await getOrCreateState(supabase, user.id); // the lock row must exist

  const usage = await gateUsage(supabase, user.id); // atomic count+check
  if (!usage.allowed) {
    return NextResponse.json({ paywall: true, usage }, { status: 402 });
  }

  // Crisis screen — responds in-voice but with real-world resources,
  // before the model sees it. Still logged + counted by the gate.
  if (isCrisisMessage(message)) {
    return NextResponse.json({ bubbles: CRISIS_RESPONSE, crisis: true });
  }

  // Serialize turns per user — double-texts/tabs/retries queue instead of
  // racing state + memory writes. Timeout → proceed degraded, never silent.
  const locked = await acquireTurnLock(supabase, user.id);
  const release = locked
    ? () => releaseTurnLock(supabase, user.id)
    : () => Promise.resolve();

  const model = getChatModel();
  try {
    const result = await orchestrate({
      supabase,
      model,
      userId: user.id,
      userMessage: message,
    });
    // The lock rides through async extraction too — memory writes serialize.
    after(async () => {
      try {
        await result.extraction;
      } finally {
        await release();
      }
    });
    return NextResponse.json({
      bubbles: result.bubbles,
      messageIds: result.assistantMessages.map((m) => m.id),
      replyDelayMs: result.replyDelayMs,
      tapback: result.tapback,
      presence: result.presence,
    });
  } catch (err) {
    console.error("[/api/chat] orchestration failed:", err);
    await release(); // orchestrate threw — nothing is holding the lock anymore
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
