"use client";

import { useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function AuthPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signInWithEmail(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error } = await getBrowserSupabase().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }



  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-amber-300 text-2xl font-semibold text-neutral-950">
            J
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Josefine</h1>
          <p className="mt-2 text-sm text-neutral-400">
            An AI companion inspired by Josefine. She remembers you.
          </p>
        </div>

        {sent ? (
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-center text-sm text-neutral-300">
            Check your email — we sent you a magic link.
          </div>
        ) : (
          <>
            <form onSubmit={signInWithEmail} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-600"
              />
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
              >
                {loading ? "Sending…" : "Continue with email"}
              </button>
            </form>
            {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
          </>
        )}

        <p className="mt-8 text-center text-xs leading-relaxed text-neutral-500">
          Josefine is an AI, not a real person. By continuing you agree this is
          an AI experience inspired by the creator.
        </p>
      </div>
    </main>
  );
}
