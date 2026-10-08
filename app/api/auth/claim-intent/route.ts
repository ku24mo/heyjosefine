import { NextResponse } from "next/server";
import {
  createServerSupabase,
  createServiceSupabase,
} from "@/lib/supabase/server";

/**
 * Marks a claim intent BEFORE updateUser — with email confirmation on, the
 * user stays anonymous until the link is tapped, possibly on another device
 * where the localStorage flag doesn't exist. claim_pending lets the first
 * confirmed mount finish the usage wipe from anywhere. Anonymous sessions
 * only — a claimed account could otherwise set this for a free usage reset.
 */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!user.is_anonymous)
    return NextResponse.json({ error: "not anonymous" }, { status: 400 });

  // Service client — claim_pending is protected from session-role writes.
  await createServiceSupabase()
    .from("profiles")
    .upsert({ id: user.id, claim_pending: true });
  return NextResponse.json({ ok: true });
}
