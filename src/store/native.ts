// StoreKit 2 on iOS, through the local MusterStore Capacitor plugin (ios/, no third-party SDK).
// The plugin's side of the contract, which the Swift code must match:
//   getProducts({ ids: string[] })  -> { products: { id, title, description, displayPrice }[] }   Product.products(for:)
//   purchase({ id: string })        -> { status: "purchased" | "pending" | "cancelled" | "failed", message? }
//                                      product.purchase(): .success(verified) finishes the transaction -> purchased,
//                                      .pending -> pending, .userCancelled -> cancelled, unverified or thrown -> failed
//   restore()                       -> { owned: string[] }   AppStore.sync(), then Transaction.currentEntitlements
//   owned()                         -> { owned: string[] }   Transaction.currentEntitlements (verified, not revoked)
//   event "ownedChanged"            -> { owned: string[] }   from Transaction.updates (Ask to Buy, refunds, other devices)
import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type { BuyResult, BuyStatus, Product, Store } from "./types";

export const PLUGIN_NAME = "MusterStore";

interface MusterStorePlugin {
  getProducts(o: { ids: string[] }): Promise<{ products: Product[] }>;
  purchase(o: { id: string }): Promise<{ status: BuyStatus; message?: string }>;
  restore(): Promise<{ owned: string[] }>;
  owned(): Promise<{ owned: string[] }>;
  addListener(event: "ownedChanged", cb: (e: { owned: string[] }) => void): Promise<PluginListenerHandle>;
}

const STATUSES: BuyStatus[] = ["purchased", "pending", "cancelled", "failed"];

export class NativeStore implements Store {
  readonly kind = "native" as const;
  private plugin = registerPlugin<MusterStorePlugin>(PLUGIN_NAME);

  async products(ids: string[]) {
    const r = await this.plugin.getProducts({ ids });
    return (r.products ?? []).filter((p) => ids.includes(p.id));
  }
  async buy(id: string): Promise<BuyResult> {
    try {
      const r = await this.plugin.purchase({ id });
      return STATUSES.includes(r.status) ? { status: r.status, message: r.message } : { status: "failed", message: "Unexpected reply from the store." };
    } catch (e) {
      return { status: "failed", message: e instanceof Error ? e.message : String(e) };
    }
  }
  async restore() { return (await this.plugin.restore()).owned ?? []; }
  async owned() { return (await this.plugin.owned()).owned ?? []; }
  onChange(cb: (owned: string[]) => void) {
    const h = this.plugin.addListener("ownedChanged", (e) => cb(e.owned ?? []));
    return () => void h.then((x) => x.remove()).catch(() => undefined);
  }
}

/** A native build without the plugin: nothing to buy, but the cached entitlement still works. */
export class UnavailableStore implements Store {
  readonly kind = "unavailable" as const;
  async products(): Promise<Product[]> { throw new Error("The App Store isn't available."); }
  async buy(): Promise<BuyResult> { return { status: "failed", message: "The App Store isn't available." }; }
  async restore(): Promise<string[]> { throw new Error("The App Store isn't available."); }
  async owned(): Promise<string[]> { throw new Error("The App Store isn't available."); }
  onChange() { return () => undefined; }
}

export const nativeStore = (): Store => (Capacitor.isPluginAvailable(PLUGIN_NAME) ? new NativeStore() : new UnavailableStore());
