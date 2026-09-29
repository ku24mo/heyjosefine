import { NextResponse } from "next/server";
import { createServerSupabase, createServiceSupabase } from "@/lib/supabase/server";

/**
 * Delete account — removes the auth user; profiles → conversations →
 * messages → memories → loops → state → usage all cascade. Works for both
 * claimed users and anonymous guests.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await createServiceSupabase().auth.admin.deleteUser(user.id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
