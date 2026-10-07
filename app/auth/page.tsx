"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

export default function AuthPage() {
  return (
    <Suspense>
      <AuthInner />
    </Suspense>
  );
}

/** Internal-only redirect target — reject absolute/protocol-relative URLs. */
function safeNext(raw: string | null): string {
  return raw?.startsWith("/") && !raw.startsWith("//") ? raw : "/";
}

function friendly(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return "wrong email or password";
  if (/already registered|already exists/i.test(msg))
    return "that email already has an account — log in instead";
  if (/rate limit|too many/i.test(msg)) return "wait a minute and try again";
  if (/password/i.test(msg) && /at least|characters/i.test(msg))
    return "at least 8 characters";
  return msg;
}

function AuthInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const linkError = params.get("error");

  // Guests carry their whole thread on the anonymous user_id — a fresh
  // signup would orphan it, so anon sessions get claim-in-place instead.
  const [session, setSession] = useState<
    "checking" | "none" | "anonymous" | "authed"
  >("checking");
  /** Anonymous user opted to log into an existing account anyway. */
  const [guestLogin, setGuestLogin] = useState(false);
  const [mode, setMode] = useState<"login" | "signup" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(
    linkError === "link_expired" ? "that link expired — try again" : null
  );
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await getBrowserSupabase().auth.getUser();
      const u = data.user;
      if (!u) setSession("none");
      else if (u.is_anonymous) setSession("anonymous");
      else {
        // Already logged in — nothing to do here. Guard a self-referencing
        // next=/auth so this can't redirect-loop.
        setSession("authed");
        router.replace(next === "/auth" ? "/" : next);
        router.refresh();
      }
    })();
  }, [router, next]);

  /** Guest claiming this thread in place (same user_id — nothing lost). */
  const claiming = session === "anonymous" && !guestLogin;
  /** Guest knowingly switching to an existing account (thread stays behind). */
  const guestSwitching = session === "anonymous" && guestLogin;

  function done() {
    // Hard refresh so the server components/routes see the fresh cookies.
    router.push(next);
    router.refresh();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    const sb = getBrowserSupabase();

    if (mode === "forgot") {
      const { error } = await sb.auth.resetPasswordForEmail(email, {
        redirectTo: `${location.origin}/auth/callback?next=/auth/reset`,
      });
      setLoading(false);
      if (error) setError(friendly(error.message));
      else setNotice("check your email — reset link sent");
      return;
    }

    if (claiming) {
      // Same in-place conversion as the claim sheet — the user_id (and every
      // message/memory hanging off it) carries over to the claimed account.
      const { error } = await sb.auth.updateUser({ email, password });
      setLoading(false);
      if (error) {
        setError(friendly(error.message));
        return;
      }
      await fetch("/api/auth/claimed", { method: "POST" }).catch(() => {});
      done();
      return;
    }

    const { data, error } =
      mode === "signup"
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(friendly(error.message));
      if (/already registered|already exists/i.test(error.message)) setMode("login");
      return;
    }
    if (mode === "signup" && !data.session) {
      // Email confirmation is off today, but if it ever flips on we say so
      // instead of silently minting a fresh guest over the new account.
      setNotice("check your email — confirm your account to keep chatting");
      return;
    }
    done();
  }

  const pwField = (
    <div className="relative">
      <input
        type={showPw ? "text" : "password"}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="password (8+ characters)"
        autoComplete={mode === "signup" || claiming ? "new-password" : "current-password"}
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
  );

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-950 px-6 text-neutral-100">
      <div className="w-full max-w-sm">
        <div className="mb-10 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-amber-300 text-2xl font-semibold text-neutral-950">
            J
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Josefine</h1>
          <p className="mt-2 text-sm text-neutral-400">
            {claiming
              ? "you're chatting as a guest — add an email + password and this thread stays yours"
              : "she remembers you."}
          </p>
        </div>

        {session === "checking" || session === "authed" ? (
          <div className="py-8 text-center text-sm text-neutral-500">…</div>
        ) : (
          <>
            {session === "none" && mode !== "forgot" && (
              <div className="mb-4 grid grid-cols-2 rounded-xl bg-neutral-900 p-1 text-sm">
                {(["login", "signup"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setMode(m);
                      setError(null);
                      setNotice(null);
                    }}
                    className={`rounded-lg py-2 transition ${mode === m ? "bg-neutral-100 text-neutral-950 font-medium" : "text-neutral-400"}`}
                  >
                    {m === "login" ? "Log in" : "Sign up"}
                  </button>
                ))}
              </div>
            )}

            <form onSubmit={submit} className="space-y-3">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                autoComplete="email"
                className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm outline-none placeholder:text-neutral-500 focus:border-neutral-600"
              />
              {mode !== "forgot" && pwField}
              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm font-medium text-neutral-950 transition hover:bg-white disabled:opacity-50"
              >
                {loading
                  ? "…"
                  : claiming
                    ? "keep this conversation"
                    : mode === "forgot"
                      ? "Send reset link"
                      : mode === "signup"
                        ? "Create account"
                        : "Log in"}
              </button>
            </form>

            {claiming && (
              <button
                type="button"
                onClick={() => {
                  setGuestLogin(true);
                  setMode("login");
                  setError(null);
                  setNotice(null);
                }}
                className="mt-3 w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
              >
                log in to an existing account instead
              </button>
            )}

            {guestSwitching && (
              <p className="mt-3 text-center text-xs leading-relaxed text-neutral-500">
                heads up — logging into another account won&apos;t bring this
                conversation with it.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setGuestLogin(false);
                    setError(null);
                    setNotice(null);
                  }}
                  className="text-neutral-300 underline underline-offset-2"
                >
                  keep this conversation instead
                </button>
              </p>
            )}

            {mode === "login" && session === "none" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setNotice(null);
                }}
                className="mt-3 w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
              >
                forgot password?
              </button>
            )}
            {guestSwitching && mode === "login" && (
              <button
                type="button"
                onClick={() => {
                  setMode("forgot");
                  setError(null);
                  setNotice(null);
                }}
                className="mt-1 w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
              >
                forgot password?
              </button>
            )}
            {mode === "forgot" && (
              <button
                type="button"
                onClick={() => setMode("login")}
                className="mt-3 w-full text-center text-xs text-neutral-500 hover:text-neutral-300"
              >
                back to log in
              </button>
            )}
          </>
        )}

        {error && <p className="mt-3 text-center text-sm text-red-400">{error}</p>}
        {notice && <p className="mt-3 text-center text-sm text-emerald-400">{notice}</p>}

        <p className="mt-8 text-center text-xs leading-relaxed text-neutral-500">
          <Link href="/" className="text-neutral-400 underline underline-offset-2">
            keep chatting as a guest
          </Link>
          {" · "}Josefine is an AI, not a real person. 18+. By continuing you
          agree this is an AI experience inspired by the creator.
        </p>
      </div>
    </main>
  );
}
