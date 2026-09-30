import type { SupabaseClient } from "@supabase/supabase-js";
import { herDaySchema } from "@/lib/ai/schemas";
import type { ChatModel } from "@/lib/ai/provider";
import { CONFIG } from "@/lib/config";
import { getLifeThreads } from "@/lib/db/queries";
import { createServiceSupabase } from "@/lib/supabase/server";
import { herNow } from "@/lib/time";
import { currentDevelopment } from "./life";
import { PERSONA } from "./profile";
import type { HerDayRow, HerDaySlot } from "@/lib/types";

/**
 * Her day sheet — one precommitted schedule per Stockholm date, global.
 * She has ONE Tuesday for everyone; the sheet is generated once and shared,
 * so "lecture at 8" can't contradict "shoot ran all morning" an hour later.
 *
 * Dated claims she makes in chat are stored as her_commitments and consumed
 * by the next generation — promises become her actual schedule.
 */

const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday",
  "thursday", "friday", "saturday",
];

/** "tomorrow" | weekday name | iso date → Stockholm date string, else null. */
export function resolveDayHint(
  hint: string | null | undefined,
  now: Date = new Date()
): string | null {
  if (!hint) return null;
  const h = hint.trim().toLowerCase();
  const today = herNow(now).date; // YYYY-MM-DD in Stockholm
  const [y, m, d] = today.split("-").map(Number);
  const addDays = (n: number) => {
    const dt = new Date(Date.UTC(y, m - 1, d + n));
    return dt.toISOString().slice(0, 10);
  };

  if (h === "today") return today;
  if (h === "tomorrow") return addDays(1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(h)) return h;

  const target = WEEKDAYS.indexOf(h);
  if (target >= 0) {
    // weekday of `today` in Stockholm
    const todayIdx = new Date(`${today}T12:00:00Z`).getUTCDay();
    let diff = (target - todayIdx + 7) % 7;
    if (diff === 0) diff = 7; // "friday" said on friday = next friday
    return addDays(diff);
  }
  return null;
}

/** Which slot she's in right now (Stockholm HH:MM), or null between slots. */
export function slotNow(
  slots: HerDaySlot[],
  now: Date = new Date()
): HerDaySlot | null {
  const t = herNow(now).time;
  return (
    slots.find((s) => s.start <= t && t < s.end) ??
    // gap between slots counts as the previous one tailing off
    [...slots].reverse().find((s) => s.end <= t && t < addHour(s.end)) ??
    null
  );
}
const addHour = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${String(h + 1).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

/** Slot kind → media subjects that are plausible right now. */
export function slotToSubjects(kind: string): string[] {
  const map: Record<string, string[]> = {
    gym: ["gym", "self"],
    tennis: ["tennis", "self"],
    shoot: ["self", "casting"],
    casting: ["self", "casting"],
    odin: ["odin"],
    home: ["self", "scene", "food"],
    parents: ["food", "odin", "scene"],
    social: ["food", "self", "scene"],
    drive: ["car", "scene"],
    uni: ["scene", "food"],
  };
  return map[kind] ?? [];
}

/** Compact day line for prompts: "08–10 lecture · 13–16 library · now ≈ gym". */
export function dayLine(day: HerDayRow | null, now: Date = new Date()): string {
  if (!day?.slots?.length) return "";
  const cur = slotNow(day.slots, now);
  const slots = day.slots
    .map((s) => `${s.start}–${s.end} ${s.label}`)
    .join(" · ");
  return `${slots}${cur ? ` — right now: ${cur.label}` : ""}`;
}

async function generateDay(
  supabase: SupabaseClient,
  model: ChatModel,
  now: Date
): Promise<{ slots: HerDaySlot[]; headline: string } | null> {
  const n = herNow(now);
  const { data: commitments } = await supabase
    .from("her_commitments")
    .select("id, content")
    .eq("target_day", n.date)
    .eq("consumed", false);
  const { data: yesterday } = await supabase
    .from("her_days")
    .select("headline")
    .lt("day", n.date)
    .order("day", { ascending: false })
    .limit(1)
    .maybeSingle();

  const threads = (await getLifeThreads(supabase, 3))
    .map((t) => currentDevelopment(t))
    .filter(Boolean)
    .slice(0, 5);

  const out = await model.generateStructured({
    schema: herDaySchema,
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content: `You plan one realistic day for Josefine, a 22-year-old law student & model in Stockholm. Output her schedule as 3-6 slots with start/end "HH:MM" (Stockholm), a short label, and a kind tag (uni|shoot|gym|tennis|odin|home|parents|social|drive|other). Leave believable gaps (meals, transit, doomscrolling). The headline is one line summing the day's character. Today is ${n.weekday} ${n.date}.
WEEKLY SHAPE (anchors, not a rigid timetable):
${PERSONA.rhythm.map((r) => `- ${r}`).join("\n")}
HER LIFE THREADS (may naturally color the day):
${threads.map((t) => `- ${t}`).join("\n") || "- quiet stretch"}
THINGS SHE TOLD PEOPLE WOULD HAPPEN TODAY (must be honored):
${(commitments ?? []).map((c) => `- ${c.content}`).join("\n") || "- none"}
YESTERDAY WAS: ${yesterday?.headline ?? "unremarkable"}
A weekday shouldn't be all highlights — a boring day is a believable day.`,
      },
    ],
  });

  // Honor commitments even if the model drifted — append them verbatim.
  const slots = out.slots.slice(0, CONFIG.life.dayMaxSlots);
  for (const c of commitments ?? []) {
    if (!slots.some((s) => s.label.toLowerCase().includes(c.content.toLowerCase().slice(0, 12)))) {
      slots.push({ start: "10:00", end: "12:00", label: c.content, kind: "commitment" });
    }
    await supabase
      .from("her_commitments")
      .update({ consumed: true })
      .eq("id", c.id);
  }
  return { slots, headline: out.headline };
}

/** Today's sheet — read-only fast path, generates once if missing. */
export async function getOrCreateHerDay(
  model: ChatModel,
  now: Date = new Date()
): Promise<HerDayRow | null> {
  const n = herNow(now);
  const supabase = createServiceSupabase();
  const { data: existing } = await supabase
    .from("her_days")
    .select("day, slots, headline, generated_at")
    .eq("day", n.date)
    .maybeSingle();
  if (existing) return existing as HerDayRow;

  const generated = await generateDay(supabase, model, now).catch(() => null);
  if (!generated) return null;
  const { data } = await supabase
    .from("her_days")
    .upsert({ day: n.date, ...generated }, { onConflict: "day" })
    .select("day, slots, headline, generated_at")
    .single();
  return (data as HerDayRow) ?? null;
}

/** Prompt-ready context: today's sheet + yesterday's headline (for callbacks). */
export async function getHerDayContext(
  model: ChatModel,
  now: Date = new Date()
): Promise<{ day: HerDayRow | null; yesterdayHeadline: string | null }> {
  try {
    const supabase = createServiceSupabase();
    const n = herNow(now);
    const [day, yesterday] = await Promise.all([
      getOrCreateHerDay(model, now),
      supabase
        .from("her_days")
        .select("headline")
        .lt("day", n.date)
        .order("day", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    return { day, yesterdayHeadline: yesterday.data?.headline ?? null };
  } catch {
    return { day: null, yesterdayHeadline: null };
  }
}
