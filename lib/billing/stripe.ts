import Stripe from "stripe";

let stripe: Stripe | null = null;

/** Lazy — routes that never touch billing don't need the env at all. */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured");
  stripe ??= new Stripe(key);
  return stripe;
}

export const appUrl = () =>
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
