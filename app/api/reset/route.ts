import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Delete conversation — starts a fresh thread. Message history is preserved
 * in the old row but no longer loaded; open loops die with the thread so she
 * doesn't resurrect dead topics. Memories persist — she still knows him.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("conversations")
    .insert({ user_id: user.id });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("open_loops")
    .update({ status: "cancelled" })
    .eq("user_id", user.id)
    .eq("status", "active");

  return NextResponse.json({ ok: true });
}
