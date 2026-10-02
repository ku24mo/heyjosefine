import { NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { maybeNudge } from "@/lib/ai/nudge";
import { ensureProfile, insertMessage } from "@/lib/db/queries";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  acquireTurnLock,
  getOrCreateState,
  releaseTurnLock,
} from "@/lib/state/conversation";

export const maxDuration = 60;

/**
 * In-conversation nudge — polled while the chat is open. Almost always
 * returns empty; fires at most once per unanswered stretch when the whole
 * gate passes (see lib/ai/nudge.ts — the gate is the product here).
 */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);
  await getOrCreateState(supabase, user.id); // lock row must exist

  // Two tabs must not double-fire — losing the race just means no nudge.
  const locked = await acquireTurnLock(supabase, user.id, { waitMs: 2_000 });
  if (!locked) return NextResponse.json({ bubbles: [] });

  try {
    const got = await maybeNudge({
      supabase,
      model: getChatModel(),
      userId: user.id,
    });
    if (!got) return NextResponse.json({ bubbles: [] });

    const messageIds: string[] = [];
    for (const [i, content] of got.result.bubbles.entries()) {
      const row = await insertMessage(supabase, {
        conversation_id: got.conversationId,
        role: "assistant",
        content,
        meta: { bubble_index: i, nudge: true },
      });
      messageIds.push(row.id);
    }
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", got.conversationId);

    return NextResponse.json({ bubbles: got.result.bubbles, messageIds });
  } finally {
    await releaseTurnLock(supabase, user.id);
  }
}
