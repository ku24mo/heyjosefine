"use client";

import { Onest } from "next/font/google";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const grotesk = Onest({ weight: ["400", "700"], subsets: ["latin"] });

// 88 square + every-5th portrait tiles — regenerate via scripts/make-collage-tiles.py
const SQ_COUNT = 88;
const COLLAGE_SQUARE = Array.from(
  { length: SQ_COUNT },
  (_, i) => `/collage/tile-${String(i + 1).padStart(2, "0")}.jpg`
);
const COLLAGE_PORTRAIT = Array.from(
  { length: Math.floor(SQ_COUNT / 5) },
  (_, i) => `/collage/ptile-${String((i + 1) * 5).padStart(2, "0")}.jpg`
);

const COLS = 5;
// Per-column drift durations — different speeds = parallax depth.
const DURS = [96, 136, 82, 118, 150];

interface Tile {
  src: string;
  portrait: boolean;
}

/** Deterministic column slices — photo i goes to column i % COLS, a portrait
 *  tile inserted every 5th slot for editorial rhythm. */
function columnTiles(col: number): Tile[] {
  const items: Tile[] = [];
  let p = 0;
  COLLAGE_SQUARE.forEach((src, i) => {
    if (i % COLS !== col) return;
    items.push({ src, portrait: false });
    if (items.length % 5 === 0) {
      items.push({
        src: COLLAGE_PORTRAIT[p++ % COLLAGE_PORTRAIT.length],
        portrait: true,
      });
    }
  });
  return items;
}

/** Stockholm clock — deterministic, no fetch. Her status is her clock. */
function herStatusLine(now: Date): string {
  const time = new Intl.DateTimeFormat("en-GB", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "Europe/Stockholm",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "numeric",
      hour12: false,
      timeZone: "Europe/Stockholm",
    }).format(now)
  );

  if (hour >= 1 && hour < 7) return `asleep — it's ${time} in stockholm`;
  if (hour >= 7 && hour < 9) return `waking up — ${time} in stockholm`;
  if (hour >= 9 && hour < 17) return `she's around — ${time} in stockholm`;
  if (hour >= 17 && hour < 22) return `evening for her — ${time} in stockholm`;
  return `probably still awake — ${time} in stockholm`;
}

/** Type→hold→delete→next loop. Reads the latest lines via ref so a late
 *  fetch (her-day) or a minute-tick never restarts the animation. */
function useTypewriter(lines: string[]): string {
  const [text, setText] = useState("");
  const linesRef = useRef(lines);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const iv = window.setInterval(
        () => setText(linesRef.current[0] ?? ""),
        500
      );
      setText(linesRef.current[0] ?? "");
      return () => clearInterval(iv);
    }
    let li = 0;
    let ci = 0;
    let deleting = false;
    let t: number;
    const step = () => {
      const pool = linesRef.current.filter(Boolean);
      if (!pool.length) {
        t = window.setTimeout(step, 400);
        return;
      }
      const line = pool[li % pool.length];
      if (!deleting) {
        ci++;
        setText(line.slice(0, ci));
        if (ci >= line.length) {
          deleting = true;
          t = window.setTimeout(step, 2400);
          return;
        }
        t = window.setTimeout(step, 32 + Math.random() * 34);
      } else {
        ci--;
        setText(line.slice(0, ci));
        if (ci <= 0) {
          deleting = false;
          li++;
          t = window.setTimeout(step, 420);
          return;
        }
        t = window.setTimeout(step, 15);
      }
    };
    t = window.setTimeout(step, 700);
    return () => clearTimeout(t);
  }, []);

  return text;
}

export default function AboutClient() {
  const [status, setStatus] = useState("");
  // Her real day — folded into the typewriter rotation when it lands.
  const [herDay, setHerDay] = useState<string | null>(null);
  const [columns] = useState(() =>
    Array.from({ length: COLS }, (_, c) => columnTiles(c))
  );

  useEffect(() => {
    const tick = () => setStatus(herStatusLine(new Date()));
    tick();
    const iv = setInterval(tick, 60_000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    void fetch("/api/her-day")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const line = d?.now?.label
          ? `right now: ${d.now.label}`
          : d?.headline
            ? `today: ${d.headline}`
            : null;
        if (line) setHerDay(line.toLowerCase());
      })
      .catch(() => {});
  }, []);

  const lines = useMemo(
    () =>
      [
        status,
        herDay,
        "she remembers what you told her tuesday",
        "sometimes she texts first",
      ].filter(Boolean) as string[],
    [status, herDay]
  );
  const typed = useTypewriter(lines);

  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#171324] text-white">
      {/* her camera roll — a contact sheet that never stops living */}
      <div className="collage-wall" aria-hidden>
        {columns.map((tiles, c) => (
          <div key={c} className={`collage-col${c % 2 ? " down" : ""}`}>
            <div
              className="collage-track"
              style={{ animationDuration: `${DURS[c % DURS.length]}s` }}
            >
              {[...tiles, ...tiles].map((t, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={t.src}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className={`collage-tile${t.portrait ? " pt" : ""}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="collage-grade" aria-hidden />
      <div className="collage-scrim" aria-hidden />
      <div className="dusk-grain" aria-hidden />

      {/* left stack — wordmark, then her typing */}
      <main className="relative z-10 flex min-h-dvh flex-col justify-center px-[7vw] pb-28">
        <h1
          className={`${grotesk.className} dusk-fade text-[24vw] font-bold leading-[0.95] tracking-tight text-white/90 sm:text-[10rem]`}
        >
          josefine
        </h1>
        <p
          className={`${grotesk.className} dusk-fade-slow mt-6 h-5 text-[13px] text-white/75 sm:text-sm`}
        >
          {typed}
          <span className="tw-caret" aria-hidden>
            |
          </span>
        </p>
        <Link
          href="/"
          className="dusk-fade-slower mt-12 w-fit rounded-full border border-white/25 bg-white/10 px-8 py-3 text-sm tracking-wide backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          text her →
        </Link>
      </main>

      <footer className="absolute bottom-6 left-0 right-0 z-10 flex items-center justify-center gap-3 text-[11px] text-white/40">
        <span>an ai companion</span>
        <span aria-hidden>·</span>
        <a
          href="https://www.instagram.com/fine__josie/"
          target="_blank"
          rel="noreferrer"
          className="hover:text-white/70"
        >
          instagram
        </a>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="hover:text-white/70">privacy</Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="hover:text-white/70">terms</Link>
      </footer>
    </div>
  );
}
