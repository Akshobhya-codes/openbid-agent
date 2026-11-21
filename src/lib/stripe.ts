import Stripe from "stripe";
import { getEnv, requireEnv } from "./env";
import type { Quote, Run } from "./types";

export function stripe() {
  const key = requireEnv("STRIPE_SECRET_KEY");
  if (!key.startsWith("sk_test_") && !key.startsWith("rk_test_")) {
    throw new Error("OpenBid only accepts Stripe TEST mode keys (sk_test_...).");
  }
  return new Stripe(key);
}

const cents = (n: number) => Math.round(n * 100);

export async function createCheckout(run: Run, quote: Quote) {
  if (quote.total === null || quote.subtotal === null || quote.deliveryFee === null || quote.taxEstimate === null) {
    throw new Error("Cannot check out an incomplete quote");
  }
  const base = getEnv("APP_BASE_URL") ?? "http://localhost:3000";
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = quote.items.map((i) => ({
    quantity: i.quantity,
    price_data: {
      currency: "usd",
      unit_amount: cents(i.unitPrice!),
      product_data: { name: `${i.name} (${i.category})`, description: `Source: ${i.evidence?.label ?? "n/a"}` },
    },
  }));
  if (quote.deliveryFee > 0) {
    lineItems.push({ quantity: 1, price_data: { currency: "usd", unit_amount: cents(quote.deliveryFee), product_data: { name: "Delivery fee" } } });
  }
  if (quote.taxEstimate > 0) {
    lineItems.push({
      quantity: 1,
      price_data: { currency: "usd", unit_amount: cents(quote.taxEstimate), product_data: { name: `Estimated sales tax (${(quote.taxRate * 100).toFixed(3)}%)` } },
    });
  }
  const metadata = { orderId: run.id, vendorId: quote.vendorId, quoteId: quote.id, auditTrailId: `audit_${run.id}` };
  return stripe().checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    metadata,
    payment_intent_data: { metadata },
    success_url: `${base}/runs/${run.id}/checkout?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/runs/${run.id}/compare?canceled=1`,
  });
}
