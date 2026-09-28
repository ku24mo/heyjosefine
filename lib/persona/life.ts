import { readdir, readFile } from "fs/promises";
import path from "path";
import { parse as parseYaml } from "yaml";
import type { LifeThreadRow } from "@/lib/types";

/** Frontmatter shape in lib/persona/life/*.md */
export interface LifeThreadSeed {
  slug: string;
  title: string;
  status: "active" | "resolved" | "paused";
  emotional_impact?: string;
  disclosure_tier: 1 | 2 | 3;
  she_wants_to_talk: boolean;
  can_open: boolean;
  timeline: { at: string; development: string }[];
}

const LIFE_DIR = path.join(process.cwd(), "lib/persona/life");

function parseThread(raw: string, filename: string): LifeThreadSeed & { body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error(`life thread ${filename}: missing frontmatter`);
  const fm = parseYaml(m[1]) as LifeThreadSeed;
  return { ...fm, body: m[2].trim() };
}

export async function loadLifeThreadSeeds(): Promise<
  (LifeThreadSeed & { body: string })[]
> {
  const files = await readdir(LIFE_DIR);
  const seeds = await Promise.all(
    files
      .filter((f) => f.endsWith(".md"))
      .map(async (f) => parseThread(await readFile(path.join(LIFE_DIR, f), "utf8"), f))
  );
  return seeds;
}

/**
 * Which development is current for a thread, given when it was seeded.
 * Timeline `at` values are offsets like "3d", "14d" from seeded_at.
 */
export function currentDevelopment(thread: LifeThreadRow): string | null {
  if (!thread.timeline?.length) return null;
  const elapsedDays =
    (Date.now() - new Date(thread.seeded_at).getTime()) / 86_400_000;
  let current: string | null = null;
  for (const t of thread.timeline) {
    const days = parseFloat(t.at);
    if (elapsedDays >= days) current = t.development;
  }
  return current;
}

/** Resolve status: mark a thread resolved if its timeline ran out. */
export function effectiveStatus(thread: LifeThreadRow): LifeThreadRow["status"] {
  if (thread.status !== "active") return thread.status;
  if (!thread.timeline?.length) return thread.status;
  const last = Math.max(
    ...thread.timeline.map((t) => parseFloat(t.at) || 0)
  );
  const elapsedDays =
    (Date.now() - new Date(thread.seeded_at).getTime()) / 86_400_000;
  // Grace period after last development before it counts as resolved.
  return elapsedDays > last + 5 ? "resolved" : "active";
}
