import Link from "next/link";

export default function Paywall() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-neutral-950 px-6 text-center text-neutral-100">
      <div className="mx-auto max-w-xs">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-rose-400 to-amber-300 text-xl font-semibold text-neutral-950">
          J
        </div>
        <h1 className="text-xl font-semibold">You&rsquo;ve hit the free limit</h1>
        <p className="mt-3 text-sm leading-relaxed text-neutral-400">
          Josefine remembers everything you&rsquo;ve told her — unlimited
          conversations are coming soon.
        </p>
        <button
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-xl bg-neutral-800 px-4 py-3 text-sm text-neutral-400"
        >
          Unlimited — coming soon
        </button>
        <Link href="/" className="mt-4 block text-xs text-neutral-500 underline">
          back to chat
        </Link>
      </div>
    </main>
  );
}
