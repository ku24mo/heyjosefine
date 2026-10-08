import { NextResponse } from "next/server";
import {
  createServerSupabase,
  createServiceSupabase,
} from "@/lib/supabase/server";

/**
 * Completes a claim after email confirmation. Same user_id — all data
 * carries — but the guest-tier usage rows are wiped so claiming feels like
 * a real upgrade (full free tier), not 30 msgs already spent. Only fires
 * when claim_pending was set via /api/auth/claim-intent — otherwise a
 * claimed user could wipe their usage rows for a free reset.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.is_anonymous)
    return NextResponse.json({ error: "not claimed" }, { status: 400 });

  const service = createServiceSupabase();
  const { data: profile } = await service
    .from("profiles")
    .select("claim_pending")
    .eq("id", user.id)
    .maybeSingle();
  if (profile?.claim_pending !== true)
    return NextResponse.json({ ok: true, wiped: false });

  await service.from("usage").delete().eq("user_id", user.id);
  await service
    .from("profiles")
    .update({ claim_pending: false })
    .eq("id", user.id);
  return NextResponse.json({ ok: true, wiped: true });
}
