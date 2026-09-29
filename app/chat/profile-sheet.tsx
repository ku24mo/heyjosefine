"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setSoundEnabled, soundEnabled } from "@/lib/sounds";
import { getBrowserSupabase } from "@/lib/supabase/client";

/** iOS-style contact sheet — profile header on top, settings below. */
export default function ProfileSheet(props: {
  open: boolean;
  onClose: () => void;
  statusLine: string;
  plan: "free" | "unlimited";
  onDeleted: () => void;
}) {
  // Remounts each time it opens — no reset-on-open effect needed.
  if (!props.open) return null;
  return <SheetInner {...props} />;
}

function SheetInner({
  onClose,
  statusLine,
  plan,
  onDeleted,
}: {
  onClose: () => void;
  statusLine: string;
  plan: "free" | "unlimited";
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [sound, setSound] = useState(() => soundEnabled());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function deleteConversation() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 4000); // un-confirm if he taps away
      return;
    }
    setBusy(true);
    await fetch("/api/reset", { method: "POST" });
    setBusy(false);
    onDeleted();
    onClose();
  }

  async function signOut() {
    await getBrowserSupabase().auth.signOut();
    router.replace("/auth");
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="sheet-backdrop absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[#f2f2f7] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-neutral-300" />

        {/* profile card */}
        <div className="flex flex-col items-center px-6 pb-5 pt-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-2xl font-semibold text-white">
            J
          </div>
          <div className="mt-2 text-xl font-semibold">Josefine</div>
          <div className="mt-0.5 text-[12px] text-neutral-500">{statusLine}</div>
          <div className="mt-2 text-center text-[13px] leading-snug text-neutral-600">
            22 · Stockholm · law student &amp; model
          </div>
        </div>

        {/* premium */}
        <div className="px-4">
          {plan === "unlimited" ? (
            <button
              onClick={async () => {
                const res = await fetch("/api/billing-portal", { method: "POST" });
                const d = await res.json();
                if (d.url) window.location.href = d.url;
              }}
              className="flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3.5 text-left active:bg-neutral-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-rose-400 to-amber-300 text-[13px] text-white">
                ★
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-medium">Josefine Unlimited</span>
                <span className="block text-[12px] text-neutral-500">active — manage subscription</span>
              </span>
              <span className="text-neutral-300">›</span>
            </button>
          ) : (
            <Link
              href="/paywall"
              className="flex items-center gap-3 rounded-xl bg-white px-4 py-3.5 active:bg-neutral-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-rose-400 to-amber-300 text-[13px] text-white">
                ★
              </span>
              <span className="flex-1 text-left">
                <span className="block text-[15px] font-medium">Josefine Unlimited</span>
                <span className="block text-[12px] text-neutral-500">$9.99 / month</span>
              </span>
              <span className="text-neutral-300">›</span>
            </Link>
          )}
        </div>

        {/* settings */}
        <div className="mt-4 px-4">
          <div className="flex items-center gap-3 rounded-xl bg-white px-4 py-3.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-[#34c759] text-[13px] text-white">
              ♪
            </span>
            <span className="flex-1 text-[15px]">Sound Effects</span>
            <button
              role="switch"
              aria-checked={sound}
              aria-label="Sound effects"
              onClick={() => {
                setSound(!sound);
                setSoundEnabled(!sound);
              }}
              className={`relative h-[31px] w-[51px] rounded-full transition-colors ${sound ? "bg-[#34c759]" : "bg-neutral-300"}`}
            >
              <span
                className={`absolute top-[2px] h-[27px] w-[27px] rounded-full bg-white shadow transition-all ${sound ? "left-[22px]" : "left-[2px]"}`}
              />
            </button>
          </div>
        </div>

        {/* destructive */}
        <div className="mt-4 space-y-px px-4">
          <button
            onClick={deleteConversation}
            disabled={busy}
            className="w-full rounded-t-xl bg-white px-4 py-3.5 text-left text-[15px] text-[#ff3b30] active:bg-neutral-100 disabled:opacity-50"
          >
            {confirming
              ? "Tap again — she'll still know you, but the thread is gone"
              : "Delete Conversation"}
          </button>
          <button
            onClick={signOut}
            className="w-full rounded-b-xl bg-white px-4 py-3.5 text-left text-[15px] text-[#ff3b30] active:bg-neutral-100"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
