"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * Password reset — the recovery link lands here via /auth/callback with a
 * live session. No session → the link was bad/expired → back to /auth.
 */
export default function ResetPage() {
  const router = useRouter();
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await getBrowserSupabase().auth.getUser();
      if (!data.user) {
        router.replace("/auth?error=link_expired");
        return;
      }
      setReady(true);
    })();
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setError("passwords don't match");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.updateUser({ password });
    setBusy(false);
    if (error) setError(error.message);
    else {
      router.push("/");
      router.refresh();
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold">New password</h1>
        {ready === null ? (
          <div className="text-center text-sm text-neutral-500">…</div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="new password (8+ characters)"
                autoComplete="new-password"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 pr-14 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-600"
              />
              <button
                type="button"
                onClick={() => setShowPw((s) => !s)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400"
              >
                {showPw ? "hide" : "show"}
              </button>
            </div>
            <input
              type={showPw ? "text" : "password"}
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="confirm password"
              autoComplete="new-password"
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-600"
            />
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
            >
              {busy ? "…" : "Update password"}
            </button>
            {error && <p className="text-center text-sm text-red-400">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
