import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * His tapback on one of HER bubbles — the mirror of her reacting to him
 * (meta.tapback). Lives in meta.user_tapback so the two never collide.
 * null emoji clears it. ❤️ only for now — the iOS double-tap default.
 */
export async function POST(request: Request) {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const messageId = typeof body?.messageId === "string" ? body.messageId : "";
  const emoji = body?.emoji === "❤️" ? "❤️" : null;
  if (!messageId) return NextResponse.json({ error: "bad message" }, { status: 400 });

  // Ownership: the message must sit in this user's conversation.
  const { data: msg } = await supabase
    .from("messages")
    .select("id, role, meta, conversation_id, conversations!inner(user_id)")
    .eq("id", messageId)
    .maybeSingle();
  const owner = (msg?.conversations as { user_id?: string } | null)?.user_id;
  if (!msg || owner !== user.id || msg.role !== "assistant") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const meta = { ...((msg.meta ?? {}) as Record<string, unknown>) };
  if (emoji) meta.user_tapback = emoji;
  else delete meta.user_tapback;
  await supabase.from("messages").update({ meta }).eq("id", messageId);
  return NextResponse.json({ ok: true });
}
