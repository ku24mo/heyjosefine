import { NextResponse } from "next/server";
import { getStripe } from "@/lib/billing/stripe";
import { bundleById } from "@/lib/store/bundles";
import { createServiceSupabase } from "@/lib/supabase/server";

export const STORE_BUCKET = "josefine-store";

/**
 * Delivery verification — the Stripe session_id is the bearer credential
 * (standard pattern; whoever holds the link holds the purchase). Verify it's
 * actually paid, then sign every file in the bundle folder for 1h. Called on
 * each success-page visit, so links never rot.
 */
export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("session_id");
  if (!sessionId?.startsWith("cs_"))
    return NextResponse.json({ error: "bad session" }, { status: 400 });

  const stripe = getStripe();
  const session = await stripe.checkout.sessions
    .retrieve(sessionId)
    .catch(() => null);
  if (!session || session.mode !== "payment")
    return NextResponse.json({ error: "not found" }, { status: 404 });
  if (session.payment_status !== "paid")
    return NextResponse.json({ error: "unpaid" }, { status: 402 });

  const bundle = session.metadata?.bundle_id
    ? bundleById(session.metadata.bundle_id)
    : undefined;
  if (!bundle)
    return NextResponse.json({ error: "unknown bundle" }, { status: 404 });

  const supabase = createServiceSupabase();
  const { data: objects } = await supabase.storage
    .from(STORE_BUCKET)
    .list(bundle.id, { limit: 100, sortBy: { column: "name", order: "asc" } });
  const paths = (objects ?? [])
    .filter((o) => o.name && !o.name.endsWith("/"))
    .map((o) => `${bundle.id}/${o.name}`);
  if (!paths.length)
    return NextResponse.json(
      { error: "no files yet — ping us and we'll fix it" },
      { status: 404 }
    );

  const { data: signed } = await supabase.storage
    .from(STORE_BUCKET)
    .createSignedUrls(paths, 3600);

  return NextResponse.json({
    bundle: { id: bundle.id, name: bundle.name },
    email: session.customer_details?.email ?? null,
    files: (signed ?? [])
      .filter((s) => s.signedUrl)
      .map((s, i) => ({ name: paths[i].split("/").pop(), url: s.signedUrl })),
  });
}
