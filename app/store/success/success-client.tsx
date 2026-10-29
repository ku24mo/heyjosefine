"use client";

import { Onest } from "next/font/google";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const grotesk = Onest({ weight: ["400", "700"], subsets: ["latin"] });

interface PurchasedFile {
  name: string;
  url: string;
}

export default function SuccessClient() {
  const sessionId = useSearchParams().get("session_id");
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error"; message: string }
    | { kind: "ok"; bundleName: string; files: PurchasedFile[] }
  >({ kind: "loading" });

  useEffect(() => {
    void (async () => {
      try {
        if (!sessionId) throw new Error("no session in this link");
        const r = await fetch(
          `/api/store/session?session_id=${encodeURIComponent(sessionId)}`
        );
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "couldn't verify this order");
        setState({ kind: "ok", bundleName: d.bundle.name, files: d.files });
      } catch (e) {
        setState({
          kind: "error",
          message: e instanceof Error ? e.message : "something broke",
        });
      }
    })();
  }, [sessionId]);

  return (
    <div
      className={`${grotesk.className} relative min-h-dvh bg-[#171324] px-6 pb-16 pt-10 text-white`}
    >
      <div className="dusk-grain" aria-hidden />
      <main className="relative z-10 mx-auto w-full max-w-sm">
        <Link
          href="/links"
          className="text-[13px] text-white/50 hover:text-white/80"
        >
          ← josefine
        </Link>

        {state.kind === "loading" && (
          <p className="mt-16 text-center text-[14px] text-white/60">
            checking your order…
          </p>
        )}

        {state.kind === "error" && (
          <div className="mt-16 text-center">
            <p className="text-[16px] font-bold">hmm, that didn&rsquo;t verify</p>
            <p className="mt-2 text-[13px] text-white/55">{state.message}</p>
            <Link
              href="/store"
              className="mt-6 inline-block rounded-full border border-white/30 bg-white/[0.14] px-6 py-2.5 text-[13px] backdrop-blur-sm hover:bg-white/25"
            >
              back to the drops
            </Link>
          </div>
        )}

        {state.kind === "ok" && (
          <>
            <h1 className="mt-8 text-[38px] font-bold leading-none tracking-tight">
              it&rsquo;s yours.
            </h1>
            <p className="mt-3 text-[14px] leading-snug text-white/60">
              {state.bundleName} — tap any photo to open it, then save it.
              links refresh each visit, so keep this page&rsquo;s url.
            </p>
            <div className="mt-6 grid grid-cols-2 gap-2">
              {state.files.map((f) => (
                <a
                  key={f.name}
                  href={f.url}
                  target="_blank"
                  rel="noreferrer"
                  className="group relative block overflow-hidden rounded-2xl border border-white/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={f.url}
                    alt={f.name}
                    className="aspect-square w-full object-cover transition-transform group-hover:scale-[1.03]"
                    loading="lazy"
                  />
                </a>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
