import { NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { generateOpening } from "@/lib/ai/opening";
import {
  ensureProfile,
  getOrCreateConversation,
  getRecentMessages,
  insertMessage,
} from "@/lib/db/queries";
import { recordMediaSend } from "@/lib/media/pick";
import { canInitiate } from "@/lib/persona/presence";
import {
  acquireTurnLock,
  getOrCreateState,
  releaseTurnLock,
} from "@/lib/state/conversation";
import { createServerSupabase } from "@/lib/supabase/server";

export const maxDuration = 60;

/** Called once when the chat screen mounts — may return a proactive opener. */
export async function GET(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  await ensureProfile(supabase, user.id);

  // Stash his IANA timezone — groundwork for shared activities ("8pm your
  // time" needs a real zone to negotiate against her Stockholm clock).
  const userTz = request.headers.get("x-user-tz");
  if (userTz && /^[A-Za-z_]+\/[A-Za-z_]+/.test(userTz)) {
    await supabase
      .from("profiles")
      .update({ user_tz: userTz.slice(0, 64) })
      .eq("id", user.id);
  }

  // Dead-night hours — she doesn't start conversations at 3am. Exception:
  // a first visit always gets an opener (the product opens itself); an
  // empty screen is a dead first impression, and the prompt is hour-aware
  // anyway so a 2am hello reads as restless-night energy.
  const conversation = await getOrCreateConversation(supabase, user.id);
  const isFirstVisit =
    (await getRecentMessages(supabase, conversation.id, 1)).length === 0;
  if (!isFirstVisit && !canInitiate())
    return NextResponse.json({ bubbles: [] });

  await getOrCreateState(supabase, user.id); // lock row must exist
  // Concurrent mounts/tabs must not double-fire an opener — short wait only;
  // losing the race just means no opener this mount.
  const locked = await acquireTurnLock(supabase, user.id, { waitMs: 2_000 });
  if (!locked) return NextResponse.json({ bubbles: [] });

  try {
    const model = getChatModel();
    const opening = await generateOpening({ supabase, model, userId: user.id });
    if (!opening) return NextResponse.json({ bubbles: [] });

    const messageIds: string[] = [];
    for (const [i, content] of opening.bubbles.entries()) {
      const row = await insertMessage(supabase, {
        conversation_id: conversation.id,
        role: "assistant",
        content,
        meta: { bubble_index: i, intention: { acts: ["callback"], openness: "leave_open", targetLength: "short", form: "single" } },
      });
      messageIds.push(row.id);
    }
    // The photo lands after her words, like a real burst of texts.
    if (opening.media) {
      const mediaMsg = await insertMessage(supabase, {
        conversation_id: conversation.id,
        role: "assistant",
        content: "",
        meta: {
          media: {
            url: opening.media.url,
            path: opening.media.asset.storage_path,
            subject: opening.media.asset.subject,
          },
        },
      });
      await recordMediaSend(supabase, user.id, opening.media.asset.id, mediaMsg.id);
      messageIds.push(mediaMsg.id);
    }
    await supabase
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);
    return NextResponse.json({
      bubbles: opening.bubbles,
      messageIds,
      strategy: opening.strategy,
      media: opening.media
        ? { url: opening.media.url, subject: opening.media.asset.subject }
        : null,
    });
  } finally {
    await releaseTurnLock(supabase, user.id);
  }
}
