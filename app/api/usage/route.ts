import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { checkUsage } from "@/lib/usage";

/** Today's usage for the meter in the profile sheet — daily only, the
 *  lifetime cap stays invisible (a countdown discourages the engagement
 *  it's meant to convert). */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const s = await checkUsage(supabase, user.id, {
    anonymous: user.is_anonymous === true,
  });
  return NextResponse.json({
    usedToday: s.usedToday,
    dailyLimit: s.dailyLimit,
  });
}
