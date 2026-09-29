import { NextResponse } from "next/server";
import { appUrl, getStripe } from "@/lib/billing/stripe";
import { createServerSupabase } from "@/lib/supabase/server";

/** Start a hosted Stripe Checkout for the $9.99/mo subscription. */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  // Guests must claim (email) first — Stripe needs it for the customer record.
  if (user.is_anonymous)
    return NextResponse.json({ error: "claim account first" }, { status: 403 });

  const price = process.env.STRIPE_PRICE_ID;
  if (!price)
    return NextResponse.json({ error: "billing not configured" }, { status: 503 });

  const stripe = getStripe();
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    customer: profile?.stripe_customer_id ?? undefined,
    customer_email: profile?.stripe_customer_id ? undefined : user.email ?? undefined,
    client_reference_id: user.id,
    metadata: { user_id: user.id },
    success_url: `${appUrl()}/chat`,
    cancel_url: `${appUrl()}/paywall`,
  });

  return NextResponse.json({ url: session.url });
}
