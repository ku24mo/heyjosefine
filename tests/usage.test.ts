import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CONFIG } from "@/lib/config";
import { gateBurst, gateUsage } from "@/lib/usage";
import { getOrCreateConversation } from "@/lib/db/queries";

/**
 * Minimal Supabase stub — fluent chain, terminal methods resolve canned
 * results. Enough to exercise the retry/fallback logic without a DB.
 */
function rpcClient(data: unknown, error: { message: string } | null = null) {
  return { rpc: async () => ({ data, error }) } as unknown as SupabaseClient;
}

type BuilderResult = { data: unknown; error: { message: string } | null };

/** Queued thenable builder — each terminal await pops the next canned result. */
function thenable(results: BuilderResult[]) {
  const builder: Record<string, unknown> = {};
  for (const m of ["from", "select", "eq", "order", "limit", "update", "insert", "in", "upsert", "or"])
    builder[m] = () => builder;
  for (const m of ["maybeSingle", "single"])
    builder[m] = async () => results.shift() ?? { data: null, error: null };
  builder.then = (resolve: (v: BuilderResult) => void) =>
    resolve(results.shift() ?? { data: null, error: null });
  return builder;
}

function tableClient(queue: BuilderResult[]) {
  return { from: () => thenable(queue) } as unknown as SupabaseClient;
}

/** from() serves canned rows per call; rpc() records name+args. */
function gateClient(opts: { rows: BuilderResult[]; rpcResults: BuilderResult[] }) {
  const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];
  const sb = {
    from: () => thenable(opts.rows),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return opts.rpcResults.shift() ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { sb, rpcCalls };
}

describe("gateBurst", () => {
  it("allows when under the limit", async () => {
    const sb = rpcClient({ allowed: true, count: 3 });
    expect(await gateBurst(sb, "u1")).toBe(true);
  });

  it("denies when over the limit", async () => {
    const sb = rpcClient({ allowed: false, count: 11 });
    expect(await gateBurst(sb, "u1")).toBe(false);
  });

  it("fails open when the RPC is missing (pre-migration)", async () => {
    const sb = rpcClient(null, { message: "function burst_gate does not exist" });
    expect(await gateBurst(sb, "u1")).toBe(true);
  });
});

describe("gateUsage tiers", () => {
  const freeProfile = { plan: "free", subscription_status: null };

  it("guests get the taste-tier limits, not the free tier", async () => {
    const { sb, rpcCalls } = gateClient({
      rows: [{ data: freeProfile, error: null }],
      rpcResults: [{ data: { allowed: true, usedToday: 3, usedTotal: 3 }, error: null }],
    });
    const s = await gateUsage(sb, "u1", { anonymous: true });
    expect(s.allowed).toBe(true);
    expect(rpcCalls[0].name).toBe("usage_gate");
    expect(rpcCalls[0].args.p_daily).toBe(CONFIG.usage.guestTotalLimit);
    expect(rpcCalls[0].args.p_total).toBe(CONFIG.usage.guestTotalLimit);
  });

  it("claimed users get the free-tier limits", async () => {
    const { sb, rpcCalls } = gateClient({
      rows: [{ data: freeProfile, error: null }],
      rpcResults: [{ data: { allowed: true, usedToday: 5, usedTotal: 5 }, error: null }],
    });
    await gateUsage(sb, "u1");
    expect(rpcCalls[0].args.p_daily).toBe(CONFIG.usage.freeDailyLimit);
    expect(rpcCalls[0].args.p_total).toBe(CONFIG.usage.freeTotalLimit);
  });

  it("unlimited plan bypasses the gate entirely", async () => {
    const { sb, rpcCalls } = gateClient({
      rows: [
        { data: { plan: "unlimited", subscription_status: "active" }, error: null },
        { data: [], error: null }, // checkUsage read
      ],
      rpcResults: [{ data: null, error: null }], // increment_usage
    });
    const s = await gateUsage(sb, "u1");
    expect(s.allowed).toBe(true);
    expect(rpcCalls.map((c) => c.name)).not.toContain("usage_gate");
  });

  it("guests still hit the wall when the RPC denies", async () => {
    const { sb } = gateClient({
      rows: [{ data: freeProfile, error: null }],
      rpcResults: [
        { data: { allowed: false, reason: "total", usedToday: 30, usedTotal: 30 }, error: null },
      ],
    });
    const s = await gateUsage(sb, "u1", { anonymous: true });
    expect(s.allowed).toBe(false);
    expect(s.totalLimit).toBe(CONFIG.usage.guestTotalLimit);
  });
});

describe("getOrCreateConversation", () => {
  const convo = { id: "c1", user_id: "u1", is_active: true };

  it("returns the active conversation when one exists", async () => {
    const sb = tableClient([{ data: convo, error: null }]);
    expect(await getOrCreateConversation(sb, "u1")).toEqual(convo);
  });

  it("creates one when none exists", async () => {
    const sb = tableClient([
      { data: null, error: null }, // select → none
      { data: convo, error: null }, // insert → created
    ]);
    expect(await getOrCreateConversation(sb, "u1")).toEqual(convo);
  });

  it("takes the winner's row when the insert loses the race", async () => {
    const sb = tableClient([
      { data: null, error: null }, // select → none
      { data: null, error: { message: "duplicate key value violates unique constraint" } }, // insert loses
      { data: convo, error: null }, // re-select → winner's row
    ]);
    expect(await getOrCreateConversation(sb, "u1")).toEqual(convo);
  });

  it("throws the insert error if no winner row appears", async () => {
    const sb = tableClient([
      { data: null, error: null },
      { data: null, error: { message: "duplicate key" } },
      { data: null, error: null },
    ]);
    await expect(getOrCreateConversation(sb, "u1")).rejects.toThrow("duplicate key");
  });
});
