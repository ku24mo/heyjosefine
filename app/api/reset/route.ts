import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Delete conversation — starts a fresh thread. Message history is preserved
 * in the old (inactive) row but no longer loaded; open loops die with the
 * thread so she doesn't resurrect dead topics. Memories persist — she still
 * knows him.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Retire the current thread, then create the new active one. The partial
  // unique index on (user_id) where is_active makes this order required.
  const { error: retireErr } = await supabase
    .from("conversations")
    .update({ is_active: false })
    .eq("user_id", user.id)
    .eq("is_active", true);
  if (retireErr) {
    // Column missing pre-migration — old behavior still works.
    if (!/is_active/.test(retireErr.message))
      return NextResponse.json({ error: retireErr.message }, { status: 500 });
  }

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
