import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./env";

let client: SupabaseClient | null = null;

/** Browser client, lazily created on first use (safe for prerendered pages). */
export function getBrowserSupabase(): SupabaseClient {
  if (!client) {
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
