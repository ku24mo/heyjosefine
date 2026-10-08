"use client";

import { Onest } from "next/font/google";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const grotesk = Onest({ weight: ["400", "700"], subsets: ["latin"] });

const COLLAGE_PHOTOS = [
  "/collage/tile-01.jpg",
  "/collage/tile-02.jpg",
  "/collage/tile-03.jpg",
  "/collage/tile-04.jpg",
  "/collage/tile-05.jpg",
  "/collage/tile-06.jpg",
  "/collage/tile-07.jpg",
];

const SLOTS = 56;
const TILTS = [-1.3, 1.1, -0.7, 1.5, -1.0, 0.8];

// Deterministic spread — a stride coprime-ish to the pool keeps neighbors
// different without Math.random in render.
function initialSlots(): string[] {
  return Array.from(
    { length: SLOTS },
    (_, i) => COLLAGE_PHOTOS[(i * 3) % COLLAGE_PHOTOS.length]
  );
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
  const [slots, setSlots] = useState<string[]>(initialSlots);

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

  // A tile quietly becomes another photo every few seconds — the wall is alive.
  useEffect(() => {
    if (COLLAGE_PHOTOS.length < 2) return;
    const iv = setInterval(() => {
      setSlots((prev) => {
        const i = Math.floor(Math.random() * prev.length);
        const next = [...prev];
        const cur = next[i];
        let cand =
          COLLAGE_PHOTOS[Math.floor(Math.random() * COLLAGE_PHOTOS.length)];
        if (cand === cur)
          cand =
            COLLAGE_PHOTOS[
              (COLLAGE_PHOTOS.indexOf(cur) + 1) % COLLAGE_PHOTOS.length
            ];
        next[i] = cand;
        return next;
      });
    }, 4800);
    return () => clearInterval(iv);
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
      {/* her life — a contact sheet under everything */}
      <div className="collage-wrap" aria-hidden>
        <div className="collage-grid">
          {slots.map((src, i) => (
            <div
              key={i}
              className="collage-cell"
              style={{ transform: `rotate(${TILTS[i % TILTS.length]}deg)` }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={src} src={src} alt="" className="collage-img" />
            </div>
          ))}
        </div>
      </div>
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
