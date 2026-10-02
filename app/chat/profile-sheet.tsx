"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CONFIG } from "@/lib/config";
import { setSoundEnabled, soundEnabled } from "@/lib/sounds";
import { getBrowserSupabase } from "@/lib/supabase/client";

/** iOS-style contact sheet — profile header on top, settings below. */
interface Relationship {
  knownSince: string | null;
  daysKnown: number;
  stage: string;
}

const STAGE_LABEL: Record<string, string> = {
  new: "just met",
  warming: "warming up",
  familiar: "familiar",
  close: "close",
};

export default function ProfileSheet(props: {
  open: boolean;
  onClose: () => void;
  statusLine: string;
  plan: "free" | "unlimited";
  anonymous: boolean;
  relationship: Relationship | null;
  /** Photos she's actually sent him — the keepsakes strip. */
  moments: string[];
  onClaim: () => void;
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
  anonymous,
  relationship,
  moments,
  onClaim,
  onDeleted,
}: {
  onClose: () => void;
  statusLine: string;
  plan: "free" | "unlimited";
  anonymous: boolean;
  relationship: Relationship | null;
  moments: string[];
  onClaim: () => void;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [sound, setSound] = useState(() => soundEnabled());
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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

  async function deleteAccount() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 4000);
      return;
    }
    setBusy(true);
    await fetch("/api/account/delete", { method: "POST" });
    // Server deleted the auth user — the local session is dead; bounce home
    // (client bootstrap will mint a fresh guest session).
    router.replace("/");
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="sheet-backdrop absolute inset-0 bg-black/35" onClick={onClose} />
      <div className="sheet-up absolute inset-x-0 bottom-0 mx-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-[#f2f2f7] pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto mt-2 h-1 w-9 rounded-full bg-neutral-300" />

        {/* profile card */}
        <div className="flex flex-col items-center px-6 pb-5 pt-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/josefine-avatar.jpg"
            alt="Josefine"
            className="h-20 w-20 rounded-full object-cover"
          />
          <div className="mt-2 text-xl font-semibold">Josefine</div>
          <div className="mt-0.5 text-[12px] text-neutral-500">{statusLine}</div>
          <div className="mt-2 text-center text-[13px] leading-snug text-neutral-600">
            22 · Stockholm · law student &amp; model
          </div>
          {relationship?.knownSince && (
            <div className="mt-3 w-full border-t border-neutral-200/60 pt-3 text-center">
              <div className="text-[13px] text-neutral-600">
                known each other since{" "}
                {new Date(relationship.knownSince).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year:
                    relationship.daysKnown >= 365 ? "numeric" : undefined,
                })}
                {" · "}
                {Math.max(1, relationship.daysKnown)}d
              </div>
              <div className="mt-0.5 text-[11px] text-neutral-400">
                {STAGE_LABEL[relationship.stage] ?? relationship.stage}
              </div>
            </div>
          )}
          {moments.length > 0 && (
            <div className="mt-3 w-full border-t border-neutral-200/60 pt-3">
              <div className="mb-2 text-center text-[11px] text-neutral-400">
                shared with you
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {moments.map((url, i) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={url}
                    alt=""
                    loading="lazy"
                    onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                    className="h-20 w-20 shrink-0 rounded-xl object-cover"
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* premium */}
        <div className="px-4">
          {anonymous ? (
            <button
              onClick={onClaim}
              className="flex w-full items-center gap-3 rounded-xl bg-white px-4 py-3.5 text-left active:bg-neutral-100"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-rose-400 to-amber-300 text-[13px] text-white">
                ★
              </span>
              <span className="flex-1">
                <span className="block text-[15px] font-medium">Claim your account</span>
                <span className="block text-[12px] text-neutral-500">
                  keep this conversation — email + password
                </span>
              </span>
              <span className="text-neutral-300">›</span>
            </button>
          ) : plan === "unlimited" ? (
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
                <span className="block text-[12px] text-neutral-500">{CONFIG.billing.monthlyUsd} / month</span>
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
            onClick={deleteAccount}
            disabled={busy}
            className="w-full bg-white px-4 py-3.5 text-left text-[15px] text-[#ff3b30] active:bg-neutral-100 disabled:opacity-50"
          >
            {confirmingDelete
              ? "Tap again — account and everything she knows, gone"
              : "Delete Account"}
          </button>
          {anonymous ? (
            <button
              onClick={onClaim}
              className="w-full rounded-b-xl bg-white px-4 py-3.5 text-left text-[15px] text-[#0a84ff] active:bg-neutral-100"
            >
              Claim Account — sign out would lose this thread
            </button>
          ) : (
            <button
              onClick={signOut}
              className="w-full rounded-b-xl bg-white px-4 py-3.5 text-left text-[15px] text-[#ff3b30] active:bg-neutral-100"
            >
              Sign Out
            </button>
          )}
        </div>

        {/* quiet footer — the way out to the site */}
        <div className="mt-6 flex items-center justify-center gap-3 pb-6 text-[11px] text-neutral-400">
          <Link href="/about" className="hover:text-neutral-600">about josefine</Link>
          <span aria-hidden>·</span>
          <Link href="/privacy" className="hover:text-neutral-600">privacy</Link>
          <span aria-hidden>·</span>
          <Link href="/terms" className="hover:text-neutral-600">terms</Link>
        </div>
      </div>
    </div>
  );
}
