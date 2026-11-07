// The in-app store, as the game sees it. One product: the one-time Full Army unlock.
// Implementations: MockStore (web and dev builds, tests, e2e) and NativeStore (StoreKit 2 through the
// local MusterStore Capacitor plugin in ios/). Prices always come from the store, never from the game.

/** The App Store product id of the Full Army unlock (a non-consumable). */
export const FULL_ARMY = "co.inflect.muster.fullarmy";

export interface Product {
  id: string;
  /** Localised name and blurb from the store. */
  title: string;
  description: string;
  /** Localised price string from the store (StoreKit `displayPrice`), e.g. "$4.99" or "4,99 €". */
  displayPrice: string;
}

/** How a buy ended. `pending` is Ask to Buy or a payment that still needs action: it may complete later. */
export type BuyStatus = "purchased" | "pending" | "cancelled" | "failed";
export interface BuyResult { status: BuyStatus; message?: string }

export type StoreKind = "mock" | "native" | "unavailable";

export interface Store {
  readonly kind: StoreKind;
  /** Product details for the given ids (missing ids are left out). Rejects when the store can't be reached. */
  products(ids: string[]): Promise<Product[]>;
  /** Starts a purchase. Resolves with how it ended; never rejects. */
  buy(id: string): Promise<BuyResult>;
  /** Restore Purchases: syncs with the store (may ask the player to sign in), then lists owned product ids. */
  restore(): Promise<string[]>;
  /** Owned product ids as the store knows them now, without prompting. */
  owned(): Promise<string[]>;
  /** Called with the full owned list whenever it changes outside a buy (Ask to Buy approved, refund, other device). */
  onChange(cb: (owned: string[]) => void): () => void;
}
