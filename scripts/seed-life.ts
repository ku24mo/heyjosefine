/**
 * Seed her life threads into Supabase: `npm run seed:life`
 * Requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * (or SUPABASE_SECRET_KEY) in .env.local
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { seedLifeThreads } from "../lib/persona/seed";

config({ path: ".env.local" });

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
    { auth: { persistSession: false } }
  );

  const { count, error } = await seedLifeThreads(supabase);
  if (error) {
    console.error("seed failed:", error);
    process.exit(1);
  }
  console.log(`seeded ${count} life threads`);
}

main();
