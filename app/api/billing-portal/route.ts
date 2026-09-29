import { NextResponse } from "next/server";
import { appUrl, getStripe } from "@/lib/billing/stripe";
import { createServerSupabase } from "@/lib/supabase/server";

/** Stripe Customer Portal — manage/cancel the subscription. */
export async function POST() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .single();
  if (!profile?.stripe_customer_id)
    return NextResponse.json({ error: "no subscription" }, { status: 404 });

  const session = await getStripe().billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${appUrl()}/chat`,
  });
  return NextResponse.json({ url: session.url });
}
