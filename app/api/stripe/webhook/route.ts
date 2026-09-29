import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/billing/stripe";
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
    const active =
      event.type !== "customer.subscription.deleted" &&
      (sub.status === "active" || sub.status === "trialing");
    // Newer Stripe APIs moved period end onto subscription items.
    const periodEnd =
      (sub as unknown as { current_period_end?: number }).current_period_end ??
      sub.items.data[0]?.current_period_end;

    await supabase
      .from("profiles")
      .update({
        plan: active ? "unlimited" : "free",
        stripe_subscription_id: sub.id,
        subscription_status: sub.status,
        current_period_end: periodEnd
          ? new Date(periodEnd * 1000).toISOString()
          : null,
      })
      .eq("stripe_customer_id", String(sub.customer));
  }

  return NextResponse.json({ received: true });
}
