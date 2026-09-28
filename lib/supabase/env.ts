/**
 * Env resolution that accepts both Supabase key naming styles:
 * legacy (ANON_KEY / SERVICE_ROLE_KEY) and new dashboard
 * (PUBLISHABLE_KEY / SECRET_KEY — the sb_publishable_/sb_secret_ keys).
 */
export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "";

export const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "";

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
