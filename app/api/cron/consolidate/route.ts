import { NextResponse } from "next/server";
import { embedTexts } from "@/lib/ai/embed";
import { getChatModel } from "@/lib/ai/deepseek";
import { consolidationSchema } from "@/lib/ai/schemas";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Daily memory consolidation — merges duplicates, archives trivia, and
 * compresses resolved storylines so long-term users' memory compounds
 * instead of accreting. Vercel cron sends Authorization: Bearer CRON_SECRET.
 */

export const maxDuration = 300;

const THRESHOLD = 30; // consolidate users past this many active memories
const HARD_CAP = 150; // archive lowest-value memories beyond this
const MAX_USERS = 25; // per run — stays well inside the function window

const CONSOLIDATE_PROMPT = `You are the memory-consolidation system for an AI companion. You are given a user's stored memories as [id] (category) content lines.

Output JSON:
- merges: groups of 2+ memories that say the same thing or belong to one storyline → one merged memory (category, content, importance 1-10, confidence 0-1, keywords, entities). The merged content should carry ALL surviving facts, written as one clean line ("User builds houses in Australia; currently subcontracting interior work").
- archive_ids: memories too trivial/stale to keep ("user said lol", "user was tired", outdated one-off events that resolved).

Rules:
- Only merge memories that genuinely overlap — never collapse distinct facts.
- Merged importance = highest of the group; confidence = highest of the group.
- Keep IDs EXACTLY as given — they are real database ids.
- If nothing needs consolidating, output empty lists — that's a valid answer.
- Preserve high-importance items even if old; archive noise, not history.`;

interface MemoryLite {
  id: string;
  category: string;
  content: string;
  importance: number;
  confidence: number;
  last_referenced_at: string | null;
}

export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  // Unset secret must fail closed — `Bearer undefined` would otherwise pass.
  if (!cronSecret)
    return NextResponse.json({ error: "not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceSupabase();
  const model = getChatModel();

  // Users whose memory table needs attention
  const { data: allRows } = await supabase
    .from("memories")
    .select("user_id")
    .eq("status", "active")
    .limit(20000);
  const counts = new Map<string, number>();
  for (const r of allRows ?? [])
    counts.set(r.user_id, (counts.get(r.user_id) ?? 0) + 1);
  const users = [...counts.entries()]
    .filter(([, n]) => n > THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_USERS)
    .map(([id]) => id);

  const results: { userId: string; merged: number; archived: number }[] = [];

  for (const userId of users) {
    const { data: mems } = await supabase
      .from("memories")
      .select("id, category, content, importance, confidence, last_referenced_at")
      .eq("user_id", userId)
      .eq("status", "active");
    const list = (mems ?? []) as MemoryLite[];
    if (list.length <= THRESHOLD) continue;

    const out = await model
      .generateStructured({
        schema: consolidationSchema,
        temperature: 0.2,
        messages: [
          { role: "system", content: CONSOLIDATE_PROMPT },
          {
            role: "user",
            content: list
              .map((m) => `[${m.id}] (${m.category}) ${m.content}`)
              .join("\n"),
          },
        ],
      })
      .catch((e) => {
        console.error(`[consolidate] model failed for ${userId}:`, e);
        return null;
      });

    let merged = 0;
    const archiveIds = new Set(out?.archive_ids ?? []);
    const validIds = new Set(list.map((m) => m.id));

    if (out) {
      for (const g of out.merges) {
        const ids = g.ids.filter((id) => validIds.has(id));
        if (ids.length < 2) continue;
        const { data: ins } = await supabase
          .from("memories")
          .insert({
            user_id: userId,
            category: g.merged.category,
            content: g.merged.content,
            importance: Math.round(g.merged.importance),
            confidence: g.merged.confidence,
            keywords: g.merged.keywords,
            entities: g.merged.entities,
            learned_from_user: false,
            supporting_memory_ids: ids,
            evidence_count: ids.length,
            related_memory_ids: ids,
            last_referenced_at: new Date().toISOString(),
          })
          .select("id")
          .single();
        for (const id of ids) archiveIds.add(id);
        merged++;
        // Embed the merged memory so semantic recall finds it immediately.
        if (ins?.id) {
          const [vec] = (await embedTexts([g.merged.content])) ?? [];
          if (vec)
            await supabase
              .from("memories")
              .update({ embedding: vec })
              .eq("id", ins.id);
        }
      }
    }

    // Hard cap: archive the weakest active memories beyond HARD_CAP.
    const surviving = list.filter((m) => !archiveIds.has(m.id));
    if (surviving.length > HARD_CAP) {
      const byValue = [...surviving].sort(
        (a, b) =>
          a.importance * a.confidence - b.importance * b.confidence ||
          (a.last_referenced_at ?? "").localeCompare(b.last_referenced_at ?? "")
      );
      for (const m of byValue.slice(0, surviving.length - HARD_CAP))
        archiveIds.add(m.id);
    }

    if (archiveIds.size) {
      await supabase
        .from("memories")
        .update({ status: "archived" })
        .in("id", [...archiveIds])
        .eq("user_id", userId);
    }
    results.push({ userId, merged, archived: archiveIds.size });
  }

  // ── stale guest sweep ──────────────────────────────────────────────────────
  // Anonymous users who never claimed leave dead auth.users rows + cascaded
  // data. Guests idle >30 days are gone for good — their session cookie is the
  // only thing that ever identified them anyway.
  let guestsDeleted = 0;
  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data: authPage } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const staleGuests = (authPage?.users ?? []).filter(
    (u) => u.is_anonymous && u.created_at < cutoff
  );
  for (const u of staleGuests) {
    const { data: st } = await supabase
      .from("conversation_state")
      .select("last_interaction_at")
      .eq("user_id", u.id)
      .maybeSingle();
    if (!st || !st.last_interaction_at || st.last_interaction_at < cutoff) {
      const { error } = await supabase.auth.admin.deleteUser(u.id);
      if (!error) guestsDeleted++;
      else console.error(`[consolidate] guest delete failed ${u.id}:`, error);
    }
  }

  return NextResponse.json({
    users: results.length,
    results,
    guestsDeleted,
  });
}
