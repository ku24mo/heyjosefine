"use client";

import { Onest } from "next/font/google";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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

/** Stockholm clock — her status is her clock. Same logic as /about. */
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

/** In-app webview (IG/TikTok/FB) — sessions die here, we push people out. */
function inAppBrowser(ua: string): boolean {
  return /instagram|tiktok|musical_ly|fbav|facebook/i.test(ua);
}

/** Type once, then stay — entry effect for the status lines. Types when the
 *  value first becomes non-empty; later updates swap in instantly (the
 *  minute-tick shouldn't re-type every time). */
function useTypeOnce(text: string): { shown: string; done: boolean } {
  const [shown, setShown] = useState("");
  const [done, setDone] = useState(false);
  const doneRef = useRef(false);

  useEffect(() => {
    if (!text) return;
    if (doneRef.current) {
      setShown(text);
      return;
    }
    let i = 0;
    const iv = window.setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) {
        doneRef.current = true;
        setDone(true);
        window.clearInterval(iv);
      }
    }, 28);
    return () => window.clearInterval(iv);
  }, [text]);

  return { shown, done };
}

export default function LinksClient() {
  const router = useRouter();
  const [columns] = useState(() =>
    Array.from({ length: COLS }, (_, c) => columnTiles(c))
  );
  const [status, setStatus] = useState("");
  const [herDay, setHerDay] = useState<string | null>(null);
  const [escapeSheet, setEscapeSheet] = useState(false);
  const [copied, setCopied] = useState(false);
  const statusTyped = useTypeOnce(status);
  const herDayTyped = useTypeOnce(herDay ?? "");

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

  function textMe() {
    const ua = navigator.userAgent;
    if (!inAppBrowser(ua)) {
      router.push("/");
      return;
    }
    if (/android/i.test(ua)) {
      // intent:// hands the URL to a real browser on Android.
      window.location.href = `intent://${window.location.host}#Intent;scheme=https;end`;
      return;
    }
    // iOS gives no escape hatch — guide them out instead.
    setEscapeSheet(true);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className={`${grotesk.className} relative min-h-dvh overflow-hidden bg-[#171324] text-white`}
    >
      {/* the wall — her camera roll drifting behind the links */}
      <div className="collage-wall links-wall dusk-fade-slow" aria-hidden>
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
                  className="mb-2 block aspect-[3/4] w-full rounded-[14px] object-cover opacity-90 saturate-[0.85]"
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
        <p className="dusk-fade-slow mt-4 h-[18px] text-[13px] text-white/70 [text-shadow:0_1px_14px_rgba(0,0,0,0.55)]">
          {statusTyped.shown}
          {!statusTyped.done && statusTyped.shown && (
            <span className="tw-caret" aria-hidden>|</span>
          )}
        </p>
        <p className="dusk-fade-slow mt-1 h-[18px] text-[13px] text-white/50 [text-shadow:0_1px_14px_rgba(0,0,0,0.55)]">
          {herDayTyped.shown}
          {!herDayTyped.done && herDayTyped.shown && (
            <span className="tw-caret" aria-hidden>|</span>
          )}
        </p>

        {/* socials — the middle row, above the door */}
        <div className="dusk-fade-slow mt-16 flex items-center gap-6">
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
          <button
            type="button"
            onClick={textMe}
            className="w-full rounded-[18px] bg-white/95 px-8 py-4 text-[15px] font-semibold tracking-wide text-[#171324] shadow-[0_8px_35px_rgba(255,255,255,0.22)] backdrop-blur-sm transition-colors hover:bg-white"
          >
            text me →
          </button>
        </div>
      </main>

      {/* iOS webview escape sheet — no programmatic way out, so we guide */}
      {escapeSheet && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <button
            aria-label="close"
            onClick={() => setEscapeSheet(false)}
            className="sheet-backdrop absolute inset-0 bg-black/60"
          />
          <div className="sheet-up relative mb-0 w-full max-w-md rounded-t-3xl bg-[#1f1a2e] px-6 pb-10 pt-6 text-center shadow-2xl">
            <div className="mx-auto h-1 w-10 rounded-full bg-white/20" />
            <p className="mt-5 text-[17px] font-semibold">open me in safari 🌐</p>
            <p className="mt-2 text-[13px] leading-snug text-white/60">
              instagram&rsquo;s browser forgets people — in safari
              she&rsquo;ll actually remember you next time.
            </p>
            <button
              type="button"
              onClick={copyLink}
              className="mt-5 w-full rounded-full bg-white/95 py-3 text-[14px] font-semibold text-[#171324] transition-colors hover:bg-white"
            >
              {copied ? "copied ✓" : "copy link"}
            </button>
            <p className="mt-3 text-[12px] text-white/45">
              or tap ⋯ at the bottom → open in browser
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
