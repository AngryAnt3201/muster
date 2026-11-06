// A stand-in store for web and dev builds, tests and e2e. Behaves like StoreKit from the game's side:
// async products, buy outcomes (picked with `mode`, or ?store=<mode> in the browser), Restore, change events.
// What it "owns" lives in its own storage key, like an Apple ID that outlives a save reset.
import { FULL_ARMY, type BuyResult, type Product, type Store } from "./types";

export type MockMode = "ok" | "pending" | "cancelled" | "failed" | "offline";
export const MOCK_MODES: MockMode[] = ["ok", "pending", "cancelled", "failed", "offline"];

type KV = Pick<Storage, "getItem" | "setItem">;
export const MOCK_KEY = "muster.mockstore.v1";

/** The mock's catalogue. The price here is the mock's own; the game only ever shows what a store returns. */
export const MOCK_PRODUCTS: Product[] = [
  { id: FULL_ARMY, title: "Full Army", description: "Every act, Gauntlet and all Breakpoint puzzles.", displayPrice: "$4.99" },
];

function memory(): KV {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

export interface MockOptions { mode?: MockMode; delay?: number; storage?: KV }

export class MockStore implements Store {
  readonly kind = "mock" as const;
  mode: MockMode;
  delay: number;
  private kv: KV;
  private subs = new Set<(owned: string[]) => void>();
  private pending: string[] = [];

  constructor(o: MockOptions = {}) {
    this.mode = o.mode ?? "ok";
    this.delay = o.delay ?? 0;
    this.kv = o.storage ?? memory();
  }

  private wait() { return new Promise<void>((r) => setTimeout(r, this.delay)); }
  private read(): string[] {
    try { const v = JSON.parse(this.kv.getItem(MOCK_KEY) ?? "{}"); return Array.isArray(v.owned) ? v.owned : []; } catch { return []; }
  }
  private write(owned: string[]) {
    try { this.kv.setItem(MOCK_KEY, JSON.stringify({ owned })); } catch { /* private mode */ }
  }
  private emit() { const o = this.read(); for (const f of this.subs) f(o); }

  async products(ids: string[]): Promise<Product[]> {
    await this.wait();
    if (this.mode === "offline") throw new Error("The store can't be reached.");
    return MOCK_PRODUCTS.filter((p) => ids.includes(p.id)).map((p) => ({ ...p }));
  }

  async buy(id: string): Promise<BuyResult> {
    await this.wait();
    if (!MOCK_PRODUCTS.some((p) => p.id === id)) return { status: "failed", message: "Unknown product." };
    switch (this.mode) {
      case "ok": {
        const o = this.read();
        if (!o.includes(id)) this.write([...o, id]);
        return { status: "purchased" };
      }
      case "pending": if (!this.pending.includes(id)) this.pending.push(id); return { status: "pending" };
      case "cancelled": return { status: "cancelled" };
      case "offline": return { status: "failed", message: "The store can't be reached." };
      default: return { status: "failed", message: "The payment was declined." };
    }
  }

  async restore(): Promise<string[]> {
    await this.wait();
    if (this.mode === "offline") throw new Error("The store can't be reached.");
    return this.read();
  }

  async owned(): Promise<string[]> { return this.read(); }

  onChange(cb: (owned: string[]) => void) { this.subs.add(cb); return () => void this.subs.delete(cb); }

  /** Test hook: a parent approves an Ask to Buy request (arrives as a change, like Transaction.updates). */
  approvePending() {
    if (!this.pending.length) return;
    const o = this.read();
    this.write([...o, ...this.pending.filter((p) => !o.includes(p))]);
    this.pending = [];
    this.emit();
  }
  /** Test hook: the store takes a product back (a refund). */
  revoke(id: string) { this.write(this.read().filter((p) => p !== id)); this.emit(); }
}
