import { NextResponse } from "next/server";
import { currentPresence } from "@/lib/persona/presence";
import { createServerSupabase } from "@/lib/supabase/server";

/** Header status line: "active now" / "sleeping" — polled by the client. */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = await currentPresence(supabase, user.id);
  return NextResponse.json({
    presence: p.state,
    staysUpLate: p.vibe.staysUpLate,
  });
}
