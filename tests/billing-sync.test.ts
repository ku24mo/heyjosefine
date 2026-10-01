import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { applySubscriptionToProfile } from "@/lib/billing/sync";

interface Call {
  update: Record<string, unknown>;
  eq: [string, string];
}

/** Chainable supabase stub — records update+eq, yields `rows` from select(). */
function fakeSupabase(customerMatchRows: { id: string }[] = []) {
  const calls: Call[] = [];
  const builder = {
    update(u: Record<string, unknown>) {
      calls.push({ update: u, eq: ["", ""] });
      return builder;
    },
    eq(col: string, val: string) {
      calls[calls.length - 1].eq = [col, val];
      return builder;
    },
    select() {
      return Promise.resolve({ data: customerMatchRows });
    },
    then(resolve: (v: { data: { id: string }[] }) => unknown) {
      return Promise.resolve({ data: [{ id: "u1" }] }).then(resolve);
    },
  };
  const client = {
    from: () => builder,
  } as unknown as SupabaseClient;
  return { client, calls };
}

function fakeSub(overrides: Partial<Stripe.Subscription> = {}) {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    metadata: {},
    items: { data: [{ current_period_end: 1_800_000_000 }] },
    ...overrides,
  } as unknown as Stripe.Subscription;
}

const stripeOk = {
  subscriptions: {
    retrieve: async () => ({ metadata: { user_id: "recovered-user" } }),
  },
} as unknown as Stripe;

describe("applySubscriptionToProfile", () => {
  it("matches by metadata.user_id and writes the customer link (order-proof)", async () => {
    const { client, calls } = fakeSupabase();
    await applySubscriptionToProfile(
      client,
      stripeOk,
      fakeSub({ metadata: { user_id: "u-meta" } })
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].eq).toEqual(["id", "u-meta"]);
    expect(calls[0].update.plan).toBe("unlimited");
    expect(calls[0].update.stripe_customer_id).toBe("cus_1");
    expect(calls[0].update.stripe_subscription_id).toBe("sub_1");
  });

  it("falls back to stripe_customer_id when metadata is absent", async () => {
    const { client, calls } = fakeSupabase([{ id: "u1" }]);
    await applySubscriptionToProfile(client, stripeOk, fakeSub());
    expect(calls).toHaveLength(1);
    expect(calls[0].eq).toEqual(["stripe_customer_id", "cus_1"]);
  });

  it("zero customer matches → retrieves the sub and matches by metadata", async () => {
    const { client, calls } = fakeSupabase([]); // select() returns []
    await applySubscriptionToProfile(client, stripeOk, fakeSub());
    expect(calls).toHaveLength(2);
    expect(calls[0].eq).toEqual(["stripe_customer_id", "cus_1"]);
    expect(calls[1].eq).toEqual(["id", "recovered-user"]);
  });

  it("deleted subscription downgrades to free", async () => {
    const { client, calls } = fakeSupabase();
    await applySubscriptionToProfile(
      client,
      stripeOk,
      fakeSub({ metadata: { user_id: "u1" } }),
      true
    );
    expect(calls[0].update.plan).toBe("free");
    expect(calls[0].update.subscription_status).toBe("active");
  });
});
