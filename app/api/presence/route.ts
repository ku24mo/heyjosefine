import { NextResponse } from "next/server";
import { currentPresence } from "@/lib/persona/presence";
import { createServerSupabase } from "@/lib/supabase/server";

/** Header status line — polled by the client. `lastSeenAt` drives "last seen". */
export async function GET() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const p = await currentPresence(supabase, user.id);
  return NextResponse.json({ presence: p.state, lastSeenAt: p.lastSeenAt });
}
