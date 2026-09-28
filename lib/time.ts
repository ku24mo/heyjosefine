/**
 * Her clock — Europe/Stockholm, always.
 * She lives in real time: "it's late" only works if she knows it's late.
 * No deps — Intl handles the timezone math (incl. DST).
 */

export type Daypart =
  | "early_morning"
  | "morning"
  | "midday"
  | "afternoon"
  | "evening"
  | "late_night";

export interface HerNow {
  /** e.g. "2026-09-28" */
  date: string;
  /** e.g. "Sunday" */
  weekday: string;
  /** 24h "HH:MM" */
  time: string;
  hour: number;
  daypart: Daypart;
}

const TZ = "Europe/Stockholm";

export function herNow(now: Date = new Date()): HerNow {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    weekday: "long",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hour = parseInt(get("hour"), 10);

  const daypart: Daypart =
    hour < 6
      ? "late_night"
      : hour < 9
        ? "early_morning"
        : hour < 12
          ? "morning"
          : hour < 14
            ? "midday"
            : hour < 18
              ? "afternoon"
              : hour < 23
                ? "evening"
                : "late_night";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    weekday: get("weekday"),
    time: `${get("hour")}:${get("minute")}`,
    hour,
    daypart,
  };
}

/** One line for the prompt: "Sunday 19:40 (evening)". */
export function herNowLine(now: Date = new Date()): string {
  const n = herNow(now);
  return `${n.weekday} ${n.time} (${n.daypart.replace("_", " ")})`;
}
