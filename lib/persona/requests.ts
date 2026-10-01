import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import { herNow } from "@/lib/time";
import type { HerRequestRow, RequestBeat, RequestKind, RequestStatus } from "@/lib/types";

/**
 * Her requests — the pacing engine.
 *
 * He says "watch money heist"; she says yes — and then it has to take as long
 * as it would take a person. Progress is a pure function of elapsed Stockholm
 * days × a per-kind daily budget × her rolled pace: no cron, no scheduler,
 * nothing to drift. `pace` and `will_drop` are rolled once at insert so the
 * outcome can't wobble between reads.
 *
 * Report beats (started → mid → done|dropped) are what she surfaces
 * unprompted — the opening engine turns a due beat into "finished it last
 * night, we need to talk about tokyo".
 */

/** "Money Heist!!" → "money heist" — dedupe key + display matching. */
export function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/** Fence a model-estimated runtime to the believable range for its kind. */
export function clampEst(kind: RequestKind, est: number): number {
  const [lo, hi] = CONFIG.requests.estClamp[kind] ?? CONFIG.requests.estClamp.other;
  return Math.round(Math.min(hi, Math.max(lo, est)));
}

const addDays = (ymd: string, n: number) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const isWeekend = (ymd: string) => {
  const wd = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return wd === 0 || wd === 6;
};

/**
 * Minutes she's plausibly put in by `now`. Day by day from the start date:
 * the acceptance evening counts less, weekends count more, and her rolled
 * pace stretches or compresses the whole curve.
 */
export function progressMinutes(
  r: Pick<HerRequestRow, "kind" | "est_minutes" | "pace" | "accepted_at" | "start_day">,
  now: Date = new Date()
): number {
  const today = herNow(now).date;
  const start = r.start_day ?? herNow(new Date(r.accepted_at)).date;
  if (today < start) return 0;

  const perDay = CONFIG.requests.dailyMinutes[r.kind] ?? CONFIG.requests.dailyMinutes.other;
  let minutes = 0;
  let day = start;
  for (let i = 0; i < 60 && day <= today; i++, day = addDays(day, 1)) {
    let budget = perDay * (isWeekend(day) ? CONFIG.requests.weekendMult : 1);
    if (i === 0) budget *= CONFIG.requests.firstDayShare;
    minutes += budget;
    if (minutes * r.pace >= r.est_minutes * 1.6) break; // far past done — stop counting
  }
  return Math.min(r.est_minutes * 1.2, Math.round(minutes * r.pace));
}

/**
 * What the request effectively is right now. Recorded terminal states are
 * binding; `will_drop` resolves to dropped once she's ~halfway in (she quits
 * partway, not at the credits).
 */
export function effectiveStatus(r: HerRequestRow, now: Date = new Date()): RequestStatus {
  if (r.status === "declined" || r.status === "done" || r.status === "dropped")
    return r.status;
  const p = progressMinutes(r, now);
  if (r.will_drop && p >= r.est_minutes * CONFIG.requests.dropAtFraction) return "dropped";
  return p >= r.est_minutes ? "done" : "doing";
}

/** Progress for display — drops freeze where she gave up. */
function shownProgress(r: HerRequestRow, now: Date): number {
  const p = progressMinutes(r, now);
  return effectiveStatus(r, now) === "dropped"
    ? Math.round(r.est_minutes * CONFIG.requests.dropAtFraction)
    : Math.min(p, r.est_minutes);
}

/** The next beat she hasn't reported yet, or null. Order: started → mid → terminal. */
export function dueBeat(r: HerRequestRow, now: Date = new Date()): RequestBeat | null {
  const status = effectiveStatus(r, now);
  if (status === "declined") return null;
  const sent = new Set(r.beats_sent);
  const p = shownProgress(r, now);

  if (!sent.has("started") && p > 0) return "started";
  if (!sent.has("mid") && p >= r.est_minutes * CONFIG.requests.midAtFraction && status === "doing")
    return "mid";
  if (status === "done" && !sent.has("done")) return "done";
  if (status === "dropped" && !sent.has("dropped")) return "dropped";
  return null;
}

/**
 * Record that she reported a beat (via opener, nudge, or saying it in-flow).
 * Terminal beats also persist the resolved status — `done`/`dropped` stops
 * pacing math and locks the outcome in.
 */
export async function markBeatSent(
  supabase: SupabaseClient,
  r: HerRequestRow,
  beat: RequestBeat,
  now: Date = new Date()
): Promise<void> {
  const terminal = beat === "done" || beat === "dropped";
  await supabase
    .from("her_requests")
    .update({
      beats_sent: [...r.beats_sent, beat],
      ...(terminal ? { status: beat } : {}),
      updated_at: now.toISOString(),
    })
    .eq("id", r.id);
}

const fmtMinutes = (m: number) =>
  m >= 90 ? `~${Math.round(m / 60)}h` : `~${m}min`;

/**
 * Queue lines for the system prompt — progress she can speak from, pending
 * reports she may volunteer, declines that keep refusals consistent.
 */
export function formatForPrompt(rows: HerRequestRow[], now: Date = new Date()): string {
  const lines: string[] = [];
  for (const r of rows) {
    const name = r.detail ? `${r.title} (${r.detail})` : r.title;
    const status = effectiveStatus(r, now);
    const beat = dueBeat(r, now);
    if (status === "declined") {
      lines.push(`- ${name}: she DECLINED — if he re-recommends, stay consistent ("i told you, not my thing 😂")`);
    } else if (status === "doing") {
      const p = shownProgress(r, now);
      lines.push(
        `- ${name}: in progress — ${fmtMinutes(p)} of ${fmtMinutes(r.est_minutes)} in${beat ? " (she hasn't told him this yet — may volunteer it)" : ""}`
      );
    } else if (status === "done") {
      lines.push(`- ${name}: FINISHED${beat ? " — hasn't told him yet, she can volunteer it with a real take" : ""}`);
    } else {
      lines.push(`- ${name}: she gave up partway${beat ? " — hasn't told him yet" : ""}`);
    }
  }
  return lines.join("\n");
}
