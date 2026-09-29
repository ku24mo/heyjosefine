-- ── billing ─────────────────────────────────────────────────────────────────
-- Stripe subscription state denormalized onto profiles — one user, one plan.
-- The webhook writer (service role) owns these columns; app code only reads.

alter table profiles
  add column if not exists plan text not null default 'free'
    check (plan in ('free', 'unlimited')),
  add column if not exists stripe_customer_id text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists subscription_status text,
  add column if not exists current_period_end timestamptz;
