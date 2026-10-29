"use client";

import { Onest } from "next/font/google";
import Link from "next/link";
import { useState } from "react";

const grotesk = Onest({ weight: ["400", "700"], subsets: ["latin"] });

const COLS = 7;
const DURS = [96, 136, 82, 118, 150, 105, 127];
const START = [0, 38, 61, 17, 74, 29, 50];

// Real photos in public/links-wall — drop more wall-N.jpg files in and bump
// this count; they cycle through the drifting columns.
const WALL_PHOTOS = 31;

/** photo i goes to column i % COLS, each repeated so every column has depth. */
function columnTiles(col: number): string[] {
  const items: string[] = [];
  for (let i = 0; i < WALL_PHOTOS * 2; i++) {
    if (i % COLS === col) items.push(`/links-wall/wall-${(i % WALL_PHOTOS) + 1}.jpg`);
  }
  return items;
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-[19px] w-[19px]">
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" />
      <circle cx="12" cy="12" r="4.4" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" className="h-[19px] w-[19px]">
      <path d="m22 2-7 20-4-9-9-4Z" />
      <path d="M22 2 11 13" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-[16px] w-[16px]">
      <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
    </svg>
  );
}

const SOCIALS = [
  { label: "instagram", href: "https://www.instagram.com/fine__josie/", Icon: InstagramIcon, color: "#E1306C" },
  { label: "telegram", href: "https://t.me/+yKJ5maD8nW4xMDgx", Icon: TelegramIcon, color: "#29A9EB" },
  { label: "x", href: "https://x.com/sage__josefine", Icon: XIcon, color: "#FFFFFF" },
];

export default function LinksClient() {
  const [columns] = useState(() =>
    Array.from({ length: COLS }, (_, c) => columnTiles(c))
  );

  return (
    <div
      className={`${grotesk.className} relative min-h-dvh overflow-hidden bg-[#171324] text-white`}
    >
      {/* the wall — her camera roll drifting behind the links */}
      <div className="collage-wall dusk-fade-slow" aria-hidden>
        {columns.map((fragments, c) => (
          <div key={c} className={`collage-col${c % 2 ? " down" : ""}`}>
            <div
              className="collage-track"
              style={{
                animationDuration: `${DURS[c % DURS.length]}s`,
                animationDelay: `-${START[c % START.length]}s`,
              }}
            >
              {[...fragments, ...fragments].map((src, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={src}
                  alt=""
                  // Phones only see columns 0–2 — eager there, lazy on the
                  // desktop-only columns so mobile doesn't fetch hidden tracks.
                  loading={c < 3 ? "eager" : "lazy"}
                  fetchPriority="low"
                  decoding="async"
                  className="mb-2 block w-full rounded-[14px] object-cover opacity-90 saturate-[0.85]"
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="collage-scrim" aria-hidden />
      <div className="collage-plate" aria-hidden />
      <div className="collage-band" aria-hidden />
      <div className="dusk-grain" aria-hidden />

      {/* centered stack — linktree-shaped for phones */}
      <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[340px] flex-col items-center justify-center px-6 pb-10 text-center">
        <h1 className="dusk-fade text-[20vw] font-bold leading-none tracking-tight text-white/95 sm:text-[7.5rem] [text-shadow:0_2px_30px_rgba(0,0,0,0.45)]">
          josefine
        </h1>

        {/* socials — the middle row, above the doors */}
        <div className="dusk-fade-slow mt-10 flex items-center gap-6">
          {SOCIALS.map(({ label, href, Icon, color }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={label}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-white/[0.10] backdrop-blur-sm transition-all hover:scale-105 hover:bg-white/20"
              style={{ color }}
            >
              <Icon />
            </a>
          ))}
        </div>

        <div className="dusk-fade-slower mt-7 flex w-full flex-col gap-3">
          <Link
            href="/store"
            className="w-full rounded-[18px] bg-white/95 px-8 py-4 text-[15px] font-semibold tracking-wide text-[#171324] shadow-[0_8px_35px_rgba(255,255,255,0.22)] backdrop-blur-sm transition-colors hover:bg-white"
          >
            exclusive photos →
          </Link>
          <Link
            href="/"
            className="w-full rounded-[18px] border border-white/35 bg-white/[0.16] px-8 py-4 text-[15px] tracking-wide text-white backdrop-blur-sm transition-colors hover:bg-white/25"
          >
            text me →
          </Link>
        </div>
      </main>
    </div>
  );
}
