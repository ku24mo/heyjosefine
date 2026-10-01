"use client";

import { Instrument_Serif } from "next/font/google";
import Link from "next/link";
import { useEffect, useState } from "react";

const serif = Instrument_Serif({ weight: "400", subsets: ["latin"] });

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

export default function AboutClient() {
  const [status, setStatus] = useState("stockholm");

  useEffect(() => {
    const tick = () => setStatus(herStatusLine(new Date()));
    tick();
    const iv = setInterval(tick, 60_000);
    return () => clearInterval(iv);
  }, []);

  return (
    <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#171324] text-white">
      {/* dusk field — three slow blobs, motion you almost can't see */}
      <div
        className="dusk-blob dusk-drift-a h-[65vmax] w-[65vmax] left-[-15vmax] top-[-20vmax] opacity-70"
        style={{ background: "radial-gradient(circle, #f2a5b8 0%, transparent 65%)" }}
      />
      <div
        className="dusk-blob dusk-drift-b h-[70vmax] w-[70vmax] right-[-20vmax] top-[10vmax] opacity-60"
        style={{ background: "radial-gradient(circle, #8b7fc4 0%, transparent 65%)" }}
      />
      <div
        className="dusk-blob dusk-drift-c h-[60vmax] w-[60vmax] left-[10vmax] bottom-[-25vmax] opacity-50"
        style={{ background: "radial-gradient(circle, #35406e 0%, transparent 65%)" }}
      />
      <div className="dusk-grain" />

      {/* center stack */}
      <main className="relative z-10 flex flex-col items-center px-6 text-center">
        <h1
          className={`${serif.className} dusk-fade text-[17vw] leading-none tracking-tight sm:text-[9rem]`}
        >
          josefine
        </h1>
        <p className="dusk-fade-slow mt-5 text-sm text-white/70 sm:text-base">
          {status}
        </p>
        <Link
          href="/"
          className="dusk-fade-slower mt-14 rounded-full border border-white/25 bg-white/10 px-8 py-3 text-sm tracking-wide backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          text her →
        </Link>
        <p className="dusk-fade-slower mt-10 max-w-[280px] text-[13px] leading-relaxed text-white/50">
          she has a lecture at 8 and a dog who steals socks. she remembers what
          you told her last tuesday. sometimes she texts first.
        </p>
      </main>

      <footer className="absolute bottom-6 z-10 flex items-center gap-3 text-[11px] text-white/40">
        <span>an ai companion</span>
        <span aria-hidden>·</span>
        <Link href="/privacy" className="hover:text-white/70">privacy</Link>
        <span aria-hidden>·</span>
        <Link href="/terms" className="hover:text-white/70">terms</Link>
      </footer>
    </div>
  );
}
