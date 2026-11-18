// Stripe: the player pays on Stripe's own page (Checkout), and Stripe tells the server when the money is in.
// No Stripe library: one call to make a session, one signature to check.
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutAsk {
  secretKey: string;
  title: string;
  /** US cents. */
  amount: number;
  player: string;
  product: string;
  offer?: string;
  successUrl: string;
  cancelUrl: string;
}
export type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/** Makes a Checkout Session for one product at the server's price. Returns Stripe's page for it. */
export async function createCheckout(a: CheckoutAsk, fetchFn: Fetch = fetch as unknown as Fetch): Promise<{ id: string; url: string }> {
  const form = new URLSearchParams({
    mode: "payment",
    success_url: a.successUrl,
    cancel_url: a.cancelUrl,
    client_reference_id: a.player,
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": String(a.amount),
    "line_items[0][price_data][product_data][name]": a.title,
    "metadata[player]": a.player,
    "metadata[product]": a.product,
    ...(a.offer ? { "metadata[offer]": a.offer } : {}),
  });
  const r = await fetchFn("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST", headers: { authorization: `Bearer ${a.secretKey}`, "content-type": "application/x-www-form-urlencoded" }, body: form.toString(),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data?.url) throw Error(`Stripe refused the checkout (${r.status}): ${data?.error?.message ?? "no reason given"}`);
  return { id: data.id, url: data.url };
}

/** Checks a webhook really came from Stripe (its `Stripe-Signature` header over the exact body) and returns the event. */
export function verifyEvent(body: string, header: string, secret: string, now = Date.now(), toleranceSec = 300): any {
  const parts = new Map(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  const t = Number(parts.get("t"));
  const given = header.split(",").map((p) => p.trim()).filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!Number.isFinite(t) || !given.length) throw Error("Bad signature");
  if (Math.abs(now / 1000 - t) > toleranceSec) throw Error("Stale signature");
  const want = Buffer.from(createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"));
  if (!given.some((g) => { const b = Buffer.from(g); return b.length === want.length && timingSafeEqual(b, want); })) throw Error("Bad signature");
  return JSON.parse(body);
}

export interface Paid { txId: string; player: string; product: string; amount: number; currency: string; }
/** A paid checkout in an event, or null for anything else (unpaid, another event type). */
export function paidCheckout(event: any): Paid | null {
  if (event?.type !== "checkout.session.completed" && event?.type !== "checkout.session.async_payment_succeeded") return null;
  const s = event.data?.object;
  if (!s || s.payment_status !== "paid" || !s.metadata?.player || !s.metadata?.product) return null;
  return { txId: String(s.id), player: String(s.metadata.player), product: String(s.metadata.product), amount: Number(s.amount_total), currency: String(s.currency) };
}
