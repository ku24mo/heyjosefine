import { NextResponse } from "next/server";
import { getChatModel } from "@/lib/ai/deepseek";
import { getOrCreateHerDay, slotNow } from "@/lib/persona/day";
import { herNow } from "@/lib/time";

export const maxDuration = 60;

/**
 * Public read of her day sheet — powers the living line on /about.
 * Her day is global by design (no user data); the worst case is one lazy
 * generation per Stockholm date, which also pre-warms it for chat.
 */
export async function GET() {
  try {
    const day = await getOrCreateHerDay(getChatModel());
    const now = day ? slotNow(day.slots) : null;
    return NextResponse.json(
      {
        headline: day?.headline ?? null,
        now: now ? { label: now.label, kind: now.kind } : null,
        time: herNow().time,
      },
      {
        headers: {
          // Her slot moves ~hourly; a few minutes of edge cache is harmless
          // and keeps hot landing traffic from hammering the DB.
          "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
        },
      }
    );
  } catch {
    // The page treats nulls as "render the static whisper" — never a 500.
    return NextResponse.json({ headline: null, now: null, time: null });
  }
}
