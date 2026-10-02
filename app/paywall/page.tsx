"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CONFIG } from "@/lib/config";

export default function Paywall() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function subscribe() {
    setBusy(true);
    setErr(null);
    const res = await fetch("/api/checkout", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) {
      router.push("/auth");
      return;
    }
    if (d.url) {
      window.location.href = d.url;
      return;
    }
    setErr(d.error === "billing not configured" ? "payments are coming soon" : "something went wrong");
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh flex-col items-center bg-[#f2f2f7] px-6 pt-[max(3rem,env(safe-area-inset-top))] text-black">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-xl font-semibold text-white">
            J
          </div>
          <h1 className="mt-3 text-xl font-semibold">Josefine Unlimited</h1>
          <div className="mt-1 text-[15px] text-neutral-500">{CONFIG.billing.monthlyUsd} / month</div>
        </div>

        <div className="mt-6 rounded-xl bg-white px-4 py-1">
          {[
            "Unlimited messages — no daily caps",
            "She remembers everything between you",
            "Her story keeps going, day after day",
          ].map((line, i) => (
            <div
              key={line}
              className={`flex items-center gap-3 py-3 text-[14px] ${i > 0 ? "border-t border-neutral-100" : ""}`}
            >
              <span className="text-[#34c759]">✓</span>
              {line}
            </div>
          ))}
        </div>

        <button
          onClick={subscribe}
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-[#0a84ff] px-4 py-3 text-[15px] font-medium text-white active:bg-[#0070e0] disabled:opacity-50"
        >
          {busy ? "redirecting…" : `Subscribe — ${CONFIG.billing.monthlyUsd}/mo`}
        </button>
        {err && <div className="mt-2 text-center text-[13px] text-rose-500">{err}</div>}
        <Link
          href="/chat"
          className="mt-4 block text-center text-[13px] text-[#0a84ff]"
        >
          back to chat
        </Link>
      </div>
    </main>
  );
}
