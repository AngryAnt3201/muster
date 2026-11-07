import { describe, expect, it } from "vitest";
import { LEVELS } from "../src/core/campaign";
import { PUZZLES } from "../src/core/puzzles";
import { StoreController, createStore, type SaveIO } from "../src/store";
import {
  FREE_ACTS, FREE_PUZZLES, actGated, gauntletGated, grant, hasFullArmy, legacyProgress, levelGated, migrateLegacy, puzzleGated, syncOwned,
  type EntitlementSave,
} from "../src/store/entitlement";
import { MOCK_KEY, MockStore } from "../src/store/mock";
import { FULL_ARMY } from "../src/store/types";

const blank = (): EntitlementSave => ({ campaign: {}, puzzles: {} });
function kv() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}
function io(s = blank()): SaveIO & { s: EntitlementSave; writes: number } {
  const o = { s, writes: 0, load: () => o.s, save: (mut: (x: EntitlementSave) => void) => { mut(o.s); o.writes++; } };
  return o;
}

describe("entitlement rules", () => {
  it("uses the App Store product id", () => expect(FULL_ARMY).toBe("co.inflect.muster.fullarmy"));

  it("leaves Acts 1-2 and puzzles 1-5 free and gates the rest, Gauntlet included", () => {
    const s = blank();
    expect(FREE_ACTS).toBe(2);
    expect(FREE_PUZZLES).toBe(5);
    for (const l of LEVELS) expect(levelGated(s, l)).toBe(l.act > 2);
    expect(LEVELS.filter((l) => !levelGated(s, l)).map((l) => l.id)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    for (const p of PUZZLES) expect(puzzleGated(s, p.id)).toBe(p.id > 5);
    expect(actGated(s, 2)).toBe(false);
    expect(actGated(s, 3)).toBe(true);
    expect(gauntletGated(s)).toBe(true);
  });

  it("opens everything once owned", () => {
    const s = blank();
    expect(grant(s, "purchase", 5)).toBe(true);
    expect(s.store).toEqual({ fullArmy: true, source: "purchase", at: 5 });
    expect(LEVELS.some((l) => levelGated(s, l))).toBe(false);
    expect(PUZZLES.some((p) => puzzleGated(s, p.id))).toBe(false);
    expect(gauntletGated(s)).toBe(false);
    expect(grant(s, "restore")).toBe(false); // already owned: no change
  });

  it("grandfathers players who cleared level 13+ (or a paid puzzle), not those still in Acts 1-2", () => {
    const early = { campaign: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 3])), puzzles: { 1: 3, 5: 1 } };
    expect(legacyProgress(early)).toBe(false);
    expect(migrateLegacy(early)).toBe(false);
    expect(hasFullArmy(early)).toBe(false);

    const tried = { campaign: { 13: 0 }, puzzles: {} }; // reached 13 but never cleared it
    expect(migrateLegacy(tried)).toBe(false);

    const vet: EntitlementSave = { campaign: { 12: 3, 13: 1 }, puzzles: {} };
    expect(migrateLegacy(vet, 9)).toBe(true);
    expect(vet.store).toEqual({ fullArmy: true, source: "legacy", at: 9 });
    expect(migrateLegacy(vet)).toBe(false);

    const solver: EntitlementSave = { campaign: {}, puzzles: { 6: 2 } };
    expect(migrateLegacy(solver)).toBe(true);
  });

  it("syncs with the store's owned list: a refund takes a bought unlock back, never a legacy one", () => {
    const bought = blank();
    expect(syncOwned(bought, [FULL_ARMY])).toBe(true);
    expect(bought.store?.source).toBe("store");
    expect(syncOwned(bought, [FULL_ARMY])).toBe(false);
    expect(syncOwned(bought, [])).toBe(true);
    expect(hasFullArmy(bought)).toBe(false);

    const vet: EntitlementSave = { campaign: { 20: 2 }, puzzles: {} };
    migrateLegacy(vet);
    expect(syncOwned(vet, [])).toBe(false);
    expect(hasFullArmy(vet)).toBe(true);

    expect(syncOwned(blank(), [])).toBe(false);

    const refunded: EntitlementSave = { campaign: { 13: 3 }, puzzles: {}, store: { fullArmy: false } };
    expect(migrateLegacy(refunded)).toBe(false);
    expect(hasFullArmy(refunded)).toBe(false);
  });
});

describe("mock store", () => {
  it("lists the Full Army with a store price and ignores unknown ids", async () => {
    const m = new MockStore();
    const ps = await m.products([FULL_ARMY, "nope"]);
    expect(ps.map((p) => p.id)).toEqual([FULL_ARMY]);
    expect(ps[0].displayPrice.length).toBeGreaterThan(0);
    expect(await m.products(["nope"])).toEqual([]);
  });

  it("buys, persists ownership in its own key and restores it", async () => {
    const storage = kv();
    const m = new MockStore({ storage });
    expect(await m.owned()).toEqual([]);
    expect(await m.buy(FULL_ARMY)).toEqual({ status: "purchased" });
    expect(JSON.parse(storage.getItem(MOCK_KEY)!)).toEqual({ owned: [FULL_ARMY], open: [] });
    expect(await new MockStore({ storage }).restore()).toEqual([FULL_ARMY]);
    expect((await m.buy("nope")).status).toBe("failed");
  });

  it("reports pending, cancelled, failed and offline without owning anything", async () => {
    for (const mode of ["pending", "cancelled", "failed", "offline"] as const) {
      const m = new MockStore({ mode });
      const r = await m.buy(FULL_ARMY);
      expect(r.status).toBe(mode === "offline" ? "failed" : mode);
      expect(await m.owned()).toEqual([]);
    }
    await expect(new MockStore({ mode: "offline" }).products([FULL_ARMY])).rejects.toThrow();
    await expect(new MockStore({ mode: "offline" }).restore()).rejects.toThrow();
  });

  it("delivers an approved Ask to Buy and a refund as change events", async () => {
    const m = new MockStore({ mode: "pending" });
    const seen: string[][] = [];
    const off = m.onChange((o) => seen.push(o));
    await m.buy(FULL_ARMY);
    m.approvePending();
    m.revoke(FULL_ARMY);
    off();
    m.approvePending();
    expect(seen).toEqual([[FULL_ARMY], []]);
  });

  it("is what web and dev builds get, with ?store= picking its behaviour", async () => {
    const s = createStore("?store=cancelled");
    expect(s.kind).toBe("mock");
    expect((s as MockStore).mode).toBe("cancelled");
    expect((createStore("?store=bogus") as MockStore).mode).toBe("ok");
  });
});

describe("store controller", () => {
  it("caches a purchase in the save and tells listeners", async () => {
    const save = io();
    const c = new StoreController(new MockStore(), save);
    await c.start();
    expect(c.owns()).toBe(false);
    let changes = 0;
    c.onChange(() => changes++);
    expect((await c.product())?.id).toBe(FULL_ARMY);
    expect((await c.buy()).status).toBe("purchased");
    expect(save.s.store).toMatchObject({ fullArmy: true, source: "purchase" });
    expect(c.owns()).toBe(true);
    expect(changes).toBe(1);
    c.dispose();
  });

  it("keeps the cached unlock offline and picks up a purchase from another device on start", async () => {
    const storage = kv();
    await new MockStore({ storage }).buy(FULL_ARMY);
    const save = io();
    const c = new StoreController(new MockStore({ storage, mode: "offline" }), save);
    await c.start();
    expect(c.owns()).toBe(true); // owned() is local, like StoreKit's cached entitlements
    await expect(c.product()).rejects.toThrow();
    await expect(c.restore()).rejects.toThrow();
    expect(c.owns()).toBe(true);
  });

  it("keeps a refund on the next launch: progress made while owning it is not legacy progress", async () => {
    const storage = kv();
    const m = new MockStore({ storage });
    const save = io();
    const c = new StoreController(m, save);
    await c.start();
    expect((await c.buy()).status).toBe("purchased");
    save.save((s) => { s.campaign[13] = 3; s.campaign[20] = 2; s.puzzles[7] = 1; });
    m.revoke(FULL_ARMY);
    expect(c.owns()).toBe(false);
    c.dispose();
    const again = new StoreController(new MockStore({ storage }), save);
    await again.start();
    expect(again.owns()).toBe(false);
  });

  it("grandfathers legacy saves on start even when the store has nothing", async () => {
    const save = io({ campaign: { 14: 2 }, puzzles: {} });
    const c = new StoreController(new MockStore(), save);
    await c.start();
    expect(save.s.store?.source).toBe("legacy");
    expect(await c.restore()).toBe(true);
  });

  it("restores, says when there's nothing to restore, and applies a later approval", async () => {
    const storage = kv();
    const m = new MockStore({ storage, mode: "pending" });
    const save = io();
    const c = new StoreController(m, save);
    await c.start();
    expect(await c.restore()).toBe(false);
    expect((await c.buy()).status).toBe("pending");
    expect(c.owns()).toBe(false);
    let changes = 0;
    c.onChange(() => changes++);
    m.approvePending();
    expect(c.owns()).toBe(true);
    expect(changes).toBe(1);
    m.revoke(FULL_ARMY);
    expect(c.owns()).toBe(false);
    expect(await c.restore()).toBe(false);

    const again = new MockStore({ storage });
    await again.buy(FULL_ARMY);
    const fresh = io();
    const c2 = new StoreController(again, fresh);
    expect(await c2.restore()).toBe(true);
    expect(fresh.s.store?.source).toBe("restore");
  });

  it("retries a failed product fetch", async () => {
    const m = new MockStore({ mode: "offline" });
    const c = new StoreController(m, io());
    await expect(c.product()).rejects.toThrow();
    m.mode = "ok";
    expect((await c.product())?.displayPrice).toBeTruthy();
  });
});
