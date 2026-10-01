import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/**
 * Apply a Stripe subscription's state to the profiles row — the single writer
 * of billing truth.
 *
 * Resolution order, because Stripe guarantees no event ordering:
 * 1. subscription metadata.user_id — set by checkout via subscription_data,
 *    works even when this event beats checkout.session.completed
 * 2. stripe_customer_id match — for subs without metadata (or pre-fix checkouts)
 * 3. a Stripe retrieve for metadata — last resort when neither links the user
 */
export async function applySubscriptionToProfile(
  supabase: SupabaseClient,
  stripe: Stripe,
  sub: Stripe.Subscription,
  deleted = false
): Promise<void> {
  const active =
    !deleted && (sub.status === "active" || sub.status === "trialing");
  // Newer Stripe APIs moved period end onto subscription items.
  const periodEnd =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end;

  const update = {
    plan: active ? "unlimited" : "free",
    stripe_customer_id: String(sub.customer),
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : null,
  };

  // 1 — user id on the subscription itself; immune to event ordering.
  if (sub.metadata?.user_id) {
    await supabase.from("profiles").update(update).eq("id", sub.metadata.user_id);
    return;
  }

  // 2 — the customer link written by checkout.session.completed.
  const { data } = await supabase
    .from("profiles")
    .update(update)
    .eq("stripe_customer_id", String(sub.customer))
    .select("id");
  if (data?.length) return;

  // 3 — zero rows: the link was never written. Ask Stripe for the sub's
  // metadata once rather than silently dropping the entitlement.
  const fresh = await stripe.subscriptions.retrieve(sub.id).catch(() => null);
  const userId = fresh?.metadata?.user_id;
  if (userId) {
    await supabase.from("profiles").update(update).eq("id", userId);
  } else {
    console.warn(`[stripe] subscription ${sub.id} matched no profile`);
  }
}
