"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * The claim wall — shown when a guest hits the taste limit. Converts the
 * anonymous user in place (same user_id — all memory carries), then resets
 * their usage so claiming feels like the full free tier.
 */
export default function ClaimSheet(props: {
  open: boolean;
  onClaimed: () => void;
  onDismiss: () => void;
}) {
  if (!props.open) return null;
  return <Inner {...props} />;
}

function Inner({
  onClaimed,
  onDismiss,
}: {
  onClaimed: () => void;
  onDismiss: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);

  async function claim(e: FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      setError("at least 8 characters");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.updateUser({
      email,
      password,
    });
    if (error) {
      setBusy(false);
      // Same email on another account → send them to login.
      if (/already|registered|exists/i.test(error.message)) setExisting(true);
      else setError(error.message);
      return;
    }
    await fetch("/api/auth/claimed", { method: "POST" }).catch(() => {});
    onClaimed();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onDismiss();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-end justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="keep this conversation"
        className="w-full max-w-md rounded-t-2xl bg-[#f2f2f7] px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5"
      >
        <div className="mx-auto mb-4 h-1 w-9 rounded-full bg-neutral-300" />

        <div className="flex flex-col items-center text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-lg font-semibold text-white">
            J
          </div>
          <h2 className="mt-3 text-[17px] font-semibold text-black">
            she wants to remember you
          </h2>
          <p className="mt-1 text-[13px] leading-snug text-neutral-500">
            drop an email + password so this thread — and everything she knows
            about you — stays yours.
          </p>
        </div>

        {existing ? (
          <>
            <div className="mt-5 rounded-xl bg-white px-4 py-4 text-center text-[14px] text-neutral-600">
              that email already has an account.{" "}
              <Link href="/auth" className="font-medium text-[#0a84ff]">
                log in
              </Link>
            </div>
            <button
              type="button"
              onClick={onDismiss}
              className="mt-3 w-full text-center text-[13px] text-neutral-400"
            >
              not now
            </button>
          </>
        ) : (
          <form onSubmit={claim} className="mt-5 space-y-2.5">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email"
              autoComplete="email"
              className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 text-[15px] text-black outline-none placeholder:text-neutral-400 focus:border-neutral-400"
            />
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="password (8+ characters)"
                autoComplete="new-password"
                className="w-full rounded-xl border border-neutral-200 bg-white px-4 py-3 pr-14 text-[15px] text-black outline-none placeholder:text-neutral-400 focus:border-neutral-400"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[13px] text-[#0a84ff]"
              >
                {showPw ? "hide" : "show"}
              </button>
            </div>
            {error && <p className="text-center text-[13px] text-rose-500">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-[#0a84ff] px-4 py-3 text-[15px] font-medium text-white active:bg-[#0070e0] disabled:opacity-50"
            >
              {busy ? "saving…" : "keep this conversation"}
            </button>
            <p className="pt-1 text-center text-[12px] text-neutral-400">
              have an account?{" "}
              <Link href="/auth" className="text-[#0a84ff]">
                log in
              </Link>
            </p>
            <button
              type="button"
              onClick={onDismiss}
              className="w-full pt-1 text-center text-[12px] text-neutral-400"
            >
              not now
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
