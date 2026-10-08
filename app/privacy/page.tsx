import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "privacy — josefine" };

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-sm leading-relaxed text-neutral-700">
      <h1 className="mb-8 text-2xl font-semibold text-neutral-900">privacy</h1>
      <p className="mb-4">
        josefine is an ai companion. this page says, plainly, what we store and why.
      </p>
      <h2 className="mb-2 mt-6 font-semibold text-neutral-900">what we store</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Your messages — the conversation itself.</li>
        <li>Memories she keeps about you — that&rsquo;s the product. It&rsquo;s how she remembers you.</li>
        <li>Usage counts and billing state (plan status, Stripe customer id).</li>
        <li>Your email, if you claim your account.</li>
      </ul>
      <h2 className="mb-2 mt-6 font-semibold text-neutral-900">what we do with it</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>Messages and memories are sent to our AI provider to generate her replies.</li>
        <li>Payments are handled by Stripe — we never see your card.</li>
        <li>We don&rsquo;t sell your data or show ads.</li>
        <li>Data is kept while your account exists — deleting your account removes it.</li>
      </ul>
      <h2 className="mb-2 mt-6 font-semibold text-neutral-900">your controls</h2>
      <ul className="list-disc space-y-1 pl-5">
        <li>You can delete your account and everything attached to it at any time.</li>
        <li>Anonymous guests can chat first — no email needed until you claim.</li>
      </ul>
      <p className="mt-8 text-neutral-400">
        questions → <a href="mailto:hello@heyjosefine.com" className="underline">hello@heyjosefine.com</a>
      </p>
      <p className="mt-8"><Link href="/about" className="text-[#0a84ff]">← about josefine</Link></p>
    </div>
  );
}
