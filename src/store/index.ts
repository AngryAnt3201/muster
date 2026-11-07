// The game's store front: picks a store for the platform, keeps the Full Army entitlement cached in the save,
// and tells screens when it changes. The UI talks only to StoreController.
import { Capacitor } from "@capacitor/core";
import { grant, hasFullArmy, migrateLegacy, syncOwned, type EntitlementSave } from "./entitlement";
import { MOCK_MODES, MockStore, type MockMode } from "./mock";
import { nativeStore } from "./native";
import { FULL_ARMY, type BuyResult, type Product, type Store } from "./types";

export { FULL_ARMY } from "./types";
export type { BuyResult, Product, Store } from "./types";

export interface SaveIO {
  load(): EntitlementSave;
  save(mut: (s: EntitlementSave) => void): void;
}

export class StoreController {
  private subs = new Set<() => void>();
  private cached: Promise<Product | null> | null = null;
  private stop: (() => void) | null = null;

  constructor(readonly store: Store, private io: SaveIO) {}

  /** Grants legacy players the unlock, then listens to the store and checks what it says is owned. */
  start() {
    this.apply((s) => migrateLegacy(s));
    this.stop = this.store.onChange((owned) => this.apply((s) => syncOwned(s, owned)));
    return this.store.owned().then((owned) => { this.apply((s) => syncOwned(s, owned)); }, () => undefined);
  }
  dispose() { this.stop?.(); this.stop = null; }

  owns() { return hasFullArmy(this.io.load()); }

  /** Called after the entitlement changes (bought, restored, approved later, refunded). */
  onChange(cb: () => void) { this.subs.add(cb); return () => void this.subs.delete(cb); }

  /** The Full Army product from the store (cached; a failed fetch is retried next time). Rejects when offline. */
  product(): Promise<Product | null> {
    if (!this.cached) {
      this.cached = this.store.products([FULL_ARMY]).then((ps) => ps.find((p) => p.id === FULL_ARMY) ?? null);
      this.cached.catch(() => { this.cached = null; });
    }
    return this.cached;
  }

  async buy(): Promise<BuyResult> {
    const r = await this.store.buy(FULL_ARMY);
    if (r.status === "purchased") this.apply((s) => grant(s, "purchase"));
    return r;
  }

  /** Restore Purchases. Resolves with whether the Full Army is owned afterwards; rejects when the store can't be reached. */
  async restore(): Promise<boolean> {
    const owned = await this.store.restore();
    this.apply((s) => (owned.includes(FULL_ARMY) ? grant(s, "restore") : syncOwned(s, owned)));
    return this.owns();
  }

  private apply(fn: (s: EntitlementSave) => boolean) {
    let changed = false;
    this.io.save((s) => { changed = fn(s); });
    if (changed) for (const f of this.subs) f();
  }
}

/** StoreKit on iOS; the mock everywhere else (?store=pending|cancelled|failed|offline picks its behaviour). */
export function createStore(search = ""): Store {
  if (Capacitor.isNativePlatform()) return nativeStore();
  const want = new URLSearchParams(search).get("store") as MockMode | null;
  let storage: Storage | undefined;
  try { storage = globalThis.localStorage; } catch { /* no storage */ }
  return new MockStore({ mode: want && MOCK_MODES.includes(want) ? want : "ok", delay: 350, storage });
}
