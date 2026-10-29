import { NextResponse } from "next/server";
import { appUrl, getStripe } from "@/lib/billing/stripe";
import { bundleById } from "@/lib/store/bundles";

/**
 * One-time photo-bundle purchase — no account required, Stripe collects the
 * email. Price/bundle data is resolved server-side; the client only sends an id.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const bundle =
    typeof body?.bundleId === "string" ? bundleById(body.bundleId) : undefined;
  if (!bundle)
    return NextResponse.json({ error: "unknown bundle" }, { status: 400 });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency: bundle.currency,
          unit_amount: bundle.priceCents,
          product_data: {
            name: `josefine — ${bundle.name}`,
            description: bundle.blurb,
          },
        },
        quantity: 1,
      },
    ],
    metadata: { bundle_id: bundle.id },
    success_url: `${appUrl()}/store/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl()}/store`,
  });

  return NextResponse.json({ url: session.url });
}
