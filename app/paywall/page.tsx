import Link from "next/link";

export default function Paywall() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-[#f2f2f7] px-6 pt-[max(3rem,env(safe-area-inset-top))] text-black">
      <div className="w-full max-w-xs">
        <div className="flex flex-col items-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-rose-300 to-amber-200 text-xl font-semibold text-white">
            J
          </div>
          <h1 className="mt-3 text-xl font-semibold">Josefine Unlimited</h1>
          <div className="mt-1 text-[15px] text-neutral-500">$9.99 / month</div>
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
          disabled
          className="mt-6 w-full cursor-not-allowed rounded-xl bg-neutral-200 px-4 py-3 text-[15px] font-medium text-neutral-400"
        >
          Coming soon
        </button>
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
