import { NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { generateOpening } from "@/lib/ai/opening";
import {
  ensureProfile,
  getOrCreateConversation,
  insertMessage,
} from "@/lib/db/queries";
import { createServerSupabase } from "@/lib/supabase/server";

/** Called once when the chat screen mounts — may return a proactive opener. */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);
  const model = getChatModel();
  const opening = await generateOpening({ supabase, model, userId: user.id });
  if (!opening) return NextResponse.json({ bubbles: [] });

  const conversation = await getOrCreateConversation(supabase, user.id);
  for (const [i, content] of opening.bubbles.entries()) {
    await insertMessage(supabase, {
      conversation_id: conversation.id,
      role: "assistant",
      content,
      meta: { bubble_index: i, intention: { acts: ["callback"], openness: "leave_open", targetLength: "short" } },
    });
  }
  await supabase
    .from("conversations")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", conversation.id);
  return NextResponse.json({
    bubbles: opening.bubbles,
    strategy: opening.strategy,
  });
}
