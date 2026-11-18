// The store when the player is signed in to a match server: the server sets the prices, Stripe takes the payment on
// its own page, and the server credits the account when Stripe confirms. Nothing is ever credited on the device.
import type { NetClient } from "../net/client";
import type { Product as ServerProduct } from "../net/protocol";
import type { BuyResult, Product, Purchase, Store } from "./types";

export class ServerStore implements Store {
  readonly kind = "server" as const;
  /** Which special offer the next tier purchase is for (src/store/pass.ts records the same on the save). */
  offer: string | null = null;
  constructor(private net: NetClient, private afterPay: () => void) {}

  async products(ids: string[]): Promise<Product[]> {
    const r = await this.net.call<{ products: ServerProduct[] }>("GET", "/v1/store");
    return r.products.filter((p) => ids.includes(p.id)).map((p) => ({ id: p.id, title: p.title, description: p.description, displayPrice: `$${p.usd.toFixed(2)}`, price: p.usd }));
  }
  async buy(id: string): Promise<BuyResult> {
    // Open the tab at once (inside the tap), then point it at Stripe: browsers block a window opened later.
    const tab = window.open("", "_blank");
    try {
      const r = await this.net.call<{ url: string }>("POST", "/v1/store/checkout", { product: id, ...(this.offer ? { offer: this.offer } : {}) });
      if (tab) tab.location.href = r.url; else location.href = r.url;
      const back = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", back); this.afterPay(); } };
      document.addEventListener("visibilitychange", back);
      return { status: "pending", message: "Finish paying in the new tab. Your purchase lands here as soon as the payment clears." };
    } catch (e) {
      tab?.close();
      return { status: "failed", message: (e as Error).message };
    } finally { this.offer = null; }
  }
  async restore() { return []; }
  async owned() { return []; }
  onChange() { return () => {}; }
  async unfinished(): Promise<Purchase[]> { return []; }
  async finish() { /* the server credits; there is nothing for the device to finish */ }
  onPurchase() { return () => {}; }
}
