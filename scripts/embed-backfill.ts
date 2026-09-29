/** One-off: embed existing memories with NULL embedding (pre-semantic rows). */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { embedTexts } from "../lib/ai/embed";

config({ path: ".env.local" });
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!,
  { auth: { persistSession: false } }
);

async function main() {
  const { data, error } = await supabase
    .from("memories")
    .select("id, content")
    .is("embedding", null)
    .eq("status", "active")
    .limit(2000);
  if (error) throw error;
  const rows = data ?? [];
  console.log(`${rows.length} memories need embeddings`);
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const vecs = await embedTexts(batch.map((r) => r.content));
    if (!vecs) {
      console.error("embedding provider unconfigured or failed — stopping");
      break;
    }
    await Promise.all(
      batch.map((r, j) =>
        vecs[j]
          ? supabase.from("memories").update({ embedding: vecs[j] }).eq("id", r.id)
          : Promise.resolve()
      )
    );
    console.log(`embedded ${Math.min(i + 50, rows.length)}/${rows.length}`);
  }
}
main().catch((e) => (console.error(e), process.exit(1)));
