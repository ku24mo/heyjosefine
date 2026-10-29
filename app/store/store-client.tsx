"use client";

import { Onest } from "next/font/google";
import Link from "next/link";
import { useState } from "react";
import { STORE_BUNDLES } from "@/lib/store/bundles";

const grotesk = Onest({ weight: ["400", "700"], subsets: ["latin"] });

export default function StoreClient() {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function buy(bundleId: string) {
    setBusy(bundleId);
    setErr(null);
    try {
      const res = await fetch("/api/store/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bundleId }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.url) throw new Error(data?.error ?? "checkout failed");
      window.location.assign(data.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "checkout failed");
      setBusy(null);
    }
  }

  return (
    <div
      className={`${grotesk.className} relative min-h-dvh overflow-hidden bg-[#171324] px-6 pb-16 pt-10 text-white`}
    >
      <div className="dusk-grain" aria-hidden />
      {/* same faded-glass atmosphere as /links — vignette + grain, no wall */}
      <div className="collage-scrim" aria-hidden />
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(150,90,110,0.10),transparent_55%)]"
        aria-hidden
      />

      <header className="relative z-10 mx-auto w-full max-w-sm pt-[4vh]">
        <Link
          href="/links"
          className="text-[13px] text-white/50 hover:text-white/80"
        >
          ← josefine
        </Link>
        <h1 className="dusk-fade mt-6 text-[42px] font-bold leading-none tracking-tight [text-shadow:0_2px_30px_rgba(0,0,0,0.45)]">
          the camera roll
        </h1>
        <p className="dusk-fade-slow mt-3 text-[14px] leading-snug text-white/60">
          real photos from her phone — not the ai. pay once, keep forever.
        </p>
      </header>

      <main className="relative z-10 mx-auto mt-8 w-full max-w-sm space-y-4">
        {STORE_BUNDLES.map((b) => (
          <div
            key={b.id}
            className="overflow-hidden rounded-[18px] border border-white/15 bg-white/[0.06] backdrop-blur-md"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={b.previews[0]}
              alt={b.name}
              className="h-28 w-full object-cover saturate-[0.9]"
            />
            <div className="p-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[16px] font-bold tracking-tight">
                  {b.name}
                </h2>
                <span className="text-[12px] text-white/50">
                  {b.photoCount} photos
                </span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-white/55">
                {b.blurb}
              </p>
              <button
                onClick={() => buy(b.id)}
                disabled={busy !== null}
                className="mt-4 w-full rounded-full border border-white/30 bg-white/[0.14] py-3 text-[14px] font-bold tracking-wide backdrop-blur-sm transition-colors hover:bg-white/25 disabled:opacity-50"
              >
                {busy === b.id
                  ? "one sec…"
                  : `get it — $${(b.priceCents / 100).toFixed(2)}`}
              </button>
            </div>
          </div>
        ))}

        {err && <p className="text-center text-[13px] text-red-300">{err}</p>}
      </main>

      <footer className="relative z-10 mx-auto mt-10 w-full max-w-sm text-center text-[11px] leading-relaxed text-white/40">
        secure checkout via stripe · files delivered right after payment
        <br />
        <Link href="/terms" className="hover:text-white/70">
          terms
        </Link>
        {" · "}
        <Link href="/privacy" className="hover:text-white/70">
          privacy
        </Link>
      </footer>
    </div>
  );
}
