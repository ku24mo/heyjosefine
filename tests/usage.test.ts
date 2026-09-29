import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { gateBurst } from "@/lib/usage";
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
