import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Called right after an anonymous user claims email+password. Same user_id —
 * all data carries — but the guest-tier usage rows are wiped so claiming
 * feels like a real upgrade (full free tier), not 30 msgs already spent.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous)
    return NextResponse.json({ error: "not claimed" }, { status: 400 });

  await supabase.from("usage").delete().eq("user_id", user.id);
  return NextResponse.json({ ok: true });
}
