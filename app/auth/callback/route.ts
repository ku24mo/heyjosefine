import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  // Internal paths only — never an open redirect. First char after "/" must
  // be a letter: rejects "//host" and "/\host" (backslash parses as a
  // separator in WHATWG URLs).
  const target = next && /^\/[a-zA-Z]/.test(next) ? next : "/";

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      return NextResponse.redirect(
        new URL("/auth?error=link_expired", url.origin)
      );
    }
  }
  return NextResponse.redirect(new URL(target, url.origin));
}
