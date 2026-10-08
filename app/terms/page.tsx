import type { Metadata } from "next";
import Link from "next/link";
import { CONFIG } from "@/lib/config";

export const metadata: Metadata = { title: "terms — josefine" };

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-16 text-sm leading-relaxed text-neutral-700">
      <h1 className="mb-8 text-2xl font-semibold text-neutral-900">terms</h1>
      <ul className="list-disc space-y-2 pl-5">
        <li>
          josefine is an AI companion. She is not a real person and does not
          claim to be. Conversations are generated.
        </li>
        <li>You must be 18 or older to use this service.</li>
        <li>
          She is not a therapist, counsellor, or emergency service. If you&rsquo;re
          in crisis, please contact local support services.
        </li>
        <li>
          Paid subscriptions ({CONFIG.billing.monthlyUsd}/month) renew monthly via Stripe and can be
          cancelled anytime — access continues to the end of the paid period;
          no partial-month refunds.
        </li>
        <li>
          This is a companion service, not an adult one — she declines sexual
          or explicit content. Don&rsquo;t use it to harm others, attempt to
          extract private data, or break the experience for other people.
        </li>
        <li>
          The service is provided as-is — it&rsquo;s early days, and
          availability or features may change.
        </li>
        <li>You can delete your account at any time; your data goes with it.</li>
      </ul>
      <p className="mt-8 text-neutral-400">
        questions → <a href="mailto:hello@heyjosefine.com" className="underline">hello@heyjosefine.com</a>
      </p>
      <p className="mt-8"><Link href="/about" className="text-[#0a84ff]">← about josefine</Link></p>
    </div>
  );
}
