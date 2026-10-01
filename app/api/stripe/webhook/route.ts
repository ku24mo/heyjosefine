import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
import { applySubscriptionToProfile } from "@/lib/billing/sync";
import { createServiceSupabase } from "@/lib/supabase/server";

/**
 * Stripe webhook — the only writer of billing state. Signature-verified,
 * service-role client (no user session exists on this path).
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = request.headers.get("stripe-signature");
  if (!secret || !sig)
    return NextResponse.json({ error: "not configured" }, { status: 503 });

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      await request.text(), // raw body — required for signature verification
      sig,
      secret
    );
  } catch {
    return NextResponse.json({ error: "bad signature" }, { status: 400 });
  }

  const supabase = createServiceSupabase();

  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const userId = s.client_reference_id ?? s.metadata?.user_id;
    if (userId && s.customer) {
      await supabase
        .from("profiles")
        .update({ stripe_customer_id: String(s.customer) })
        .eq("id", userId);
    }
  }

  if (
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted"
  ) {
    const sub = event.data.object as Stripe.Subscription;
    await applySubscriptionToProfile(
      supabase,
      getStripe(),
      sub,
      event.type === "customer.subscription.deleted"
    );
  }

  return NextResponse.json({ received: true });
}
