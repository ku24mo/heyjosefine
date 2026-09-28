import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseServiceKey, supabaseUrl } from "./env";

/** Session-bound client (user's RLS context). Use in route handlers/pages. */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll from a Server Component — middleware refreshes sessions
        }
      },
    },
  });
}

/** Service-role client — bypasses RLS. Server-only, never expose to browser. */
export function createServiceSupabase() {
  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
