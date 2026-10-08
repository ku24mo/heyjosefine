import { NextResponse } from "next/server";
import { CONFIG } from "@/lib/config";
import { createServiceSupabase } from "@/lib/supabase/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/env";

/**
 * Anonymous-first entry: mint a guest session. IP-capped so scripts can't
 * farm free tiers; the session cookie is identical to a real login.
 */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) =>
        toSet.forEach(({ name, value, options }) =>
          cookieStore.set(name, value, options)
        ),
    },
  });

  // Two tabs racing bootstrap would each mint an anon user — the loser's
  // cookie gets overwritten mid-conversation. If a valid session already
  // exists (guest or claimed), this call is a no-op.
  const { data: existing } = await supabase.auth.getUser();
  if (existing.user) return NextResponse.json({ ok: true });

  // Best-effort client IP for the rate gate.
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    null;

  if (ip) {
    const service = createServiceSupabase();
    const { data, error } = await service.rpc("guest_gate", {
      p_ip: ip,
      p_limit: CONFIG.usage.guestCreationsPerDay,
      p_window_seconds: 86_400,
    });
    if (!error && data && data.allowed === false) {
      return NextResponse.json({ error: "try again later" }, { status: 429 });
    }
    // RPC/table missing pre-migration → fail open, same as other gates.
  }

  const { error } = await supabase.auth.signInAnonymously();
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
