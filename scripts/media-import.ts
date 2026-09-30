/**
 * Import the media library into Supabase.
 *
 *   npx tsx scripts/media-import.ts ./media-library
 *   npx tsx scripts/media-import.ts ./media-library --dry-run
 *
 * Convention:
 *   <root>/<subject>/d<unlock-day>-<tags...>.<ext>
 *   e.g. odin/d3-socks.jpg  →  subject=odin, unlock_day=3, tags=[socks]
 *   comfort tag: include "comfort" in the filename  (e.g. d5-coffee-comfort.jpg)
 *   intimacy tier: folder path containing "close" → tier 3,
 *                  subject "self" → tier 2, else → tier 1
 *
 * Safe to re-run: files already imported (same storage path) are skipped.
 */
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";

config({ path: ".env.local" });

const BUCKET = "josefine-media";
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
};

interface Parsed {
  absPath: string;
  storagePath: string; // subject/filename — stable identity across re-imports
  subject: string;
  unlockDay: number;
  tags: string[];
  intimacyTier: number;
}

export function parsePath(root: string, absPath: string): Parsed | string {
  const rel = relative(root, absPath).split("\\").join("/");
  const parts = rel.split("/");
  if (parts.length < 2) return `not in a subject folder: ${rel}`;
  const subject = parts[0].toLowerCase();
  const file = basename(absPath);
  const ext = extname(file).toLowerCase();
  if (!EXTENSIONS.has(ext)) return `unsupported extension: ${rel}`;

  const stem = file.slice(0, -ext.length);
  const m = stem.match(/^d(\d+)-(.+)$/);
  if (!m) return `filename must start with d<day>-<tags>: ${rel}`;
  const unlockDay = parseInt(m[1], 10);
  if (unlockDay < 1 || unlockDay > 400) return `bad unlock day: ${rel}`;

  const tags = m[2].split("-").map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (!tags.length) return `no tags in filename: ${rel}`;

  const intimacyTier =
    parts.slice(1, -1).some((p) => p.toLowerCase() === "close") ? 3
    : subject === "self" ? 2
    : 1;

  return {
    absPath,
    storagePath: rel,
    subject,
    unlockDay,
    tags,
    intimacyTier,
  };
}

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

async function main() {
  const root = process.argv[2];
  const dryRun = process.argv.includes("--dry-run");
  if (!root) {
    console.error("usage: tsx scripts/media-import.ts <library-dir> [--dry-run]");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY)!
  );

  // already-imported paths → skip
  const { data: existing } = await supabase
    .from("media_assets")
    .select("storage_path");
  const seen = new Set((existing ?? []).map((r) => r.storage_path as string));

  let uploaded = 0, skipped = 0, failed = 0;
  for (const absPath of walk(root)) {
    const parsed = parsePath(root, absPath);
    if (typeof parsed === "string") {
      console.log(`  ✗ ${parsed}`);
      failed++;
      continue;
    }
    if (seen.has(parsed.storagePath)) {
      skipped++;
      continue;
    }
    console.log(
      `  ${dryRun ? "·" : "→"} ${parsed.storagePath}  day=${parsed.unlockDay} tier=${parsed.intimacyTier} tags=${parsed.tags.join(",")}`
    );
    if (dryRun) {
      uploaded++;
      continue;
    }
    try {
      const bytes = readFileSync(absPath);
      const { error: upErr } = await supabase.storage
        .from(BUCKET)
        .upload(parsed.storagePath, bytes, {
          contentType: MIME[extname(absPath).toLowerCase()],
          upsert: false,
        });
      if (upErr) throw new Error(upErr.message);
      const { error: insErr } = await supabase.from("media_assets").insert({
        storage_path: parsed.storagePath,
        subject: parsed.subject,
        tags: parsed.tags,
        unlock_day: parsed.unlockDay,
        intimacy_tier: parsed.intimacyTier,
        enabled: true,
      });
      if (insErr) throw new Error(insErr.message);
      uploaded++;
      seen.add(parsed.storagePath);
    } catch (e) {
      console.log(`  ✗ ${parsed.storagePath}: ${(e as Error).message}`);
      failed++;
    }
  }
  console.log(`\ndone: ${uploaded} ${dryRun ? "would import" : "imported"}, ${skipped} already in library, ${failed} failed`);
}

if (process.argv[1]?.endsWith("media-import.ts")) {
  void main();
}
