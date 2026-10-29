-- ── photo store ─────────────────────────────────────────────────────────────
-- One-time bundle purchases. The session_id is the delivery credential — the
-- success page verifies it live against Stripe, so this table is the durable
-- record (order history, future re-access, support), not the access mechanism.
-- RLS on with no policies = service-role only; buyers never query it directly.

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique,
  bundle_id text not null,
  email text,
  amount_total int,
  currency text,
  created_at timestamptz not null default now()
);
create index if not exists purchases_email_idx on purchases(email);

alter table purchases enable row level security;

-- Bundle file delivery — private bucket, service-role signed URLs only
-- (same pattern as josefine-media post-0016). Files live under <bundle_id>/.
insert into storage.buckets (id, name, public)
values ('josefine-store', 'josefine-store', false)
on conflict (id) do nothing;
