import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { GEM_PACKS } from "../src/economy/gems";
import { buyCoinBundle } from "../src/economy/rewards";
import type { SoloState } from "../src/net/protocol";
import { openReady, startUnlock, grantChest } from "../src/progression/chests";
import { upgradeCards, upgradeCoins } from "../src/progression/economy";
import { campaignResult } from "../src/progression/results";
import { upgradeTroop } from "../src/progression/troops";
import { adoptSave, load } from "../src/save";
import { STARTER } from "../src/store/types";
import { setOpSink, setSeedSource } from "../src/sync";
import * as Acct from "../server/account";
import { createApp, type App } from "../server/app";
import { Hub } from "../server/hub";
import { Store } from "../server/store";

type AnySave = Record<string, any>;
const mk = () => { const hub = new Hub(new Store()); const me = hub.register("Player", "web").me; return { hub, id: me.id }; };
const dice = new Acct.Dice("test");

describe("the solo economy lives on the server", () => {
  it("a new account is the game's own fresh save: starter units found, nothing in the purse", () => {
    const { hub, id } = mk();
    const st = hub.solo(id, -420);
    const s = st.save as AnySave;
    expect([...s.collection.found].sort()).toEqual(["blades", "medic", "mine", "ranger"]);
    expect(s.wallet?.coins ?? 0).toBe(0);
    expect(st.seeds).toHaveLength(8);
    expect(s.settings).toBeUndefined(); // the device keeps its own settings
    expect(hub.account(id).units.every((u) => u.level === 1)).toBe(true);
  });

  it("only named actions run, each behind its guard: no minting, no skipping ahead, no results in a hurry", () => {
    const rec = Acct.newRecord();
    const t0 = 1_800_000_000_000;
    const run = (ops: Acct.OpCall[], now: number) => Acct.runOps(rec, "p", dice, ops, now).map((r) => `${r.name}: ${r.why}`);
    const coins = () => (rec.save.wallet?.coins ?? 0);
    // The pieces the rules are built from are not actions.
    expect(run([{ name: "wallet.earn", args: ["coins", 99999] }, { name: "earn", args: ["gems", 5] }, { name: "chests.grant", args: [{ type: "legendary" }] }], t0))
      .toEqual(["wallet.earn: Unknown action", "earn: Unknown action", "chests.grant: Unknown action"]);
    expect(coins()).toBe(0);
    // A level that is not open yet; nonsense arguments.
    expect(run([{ name: "result.campaign", args: [5, true, 3] }], t0)).toEqual(["result.campaign: That level is not open yet"]);
    expect(run([{ name: "result.campaign", args: [1, true, 9] }, { name: "result.campaign", args: ["1", true, 3] }, { name: "army.upgrade", args: ["dragon"] }], t0)).toHaveLength(3);
    // The first level, won with three stars: paid once, stars kept, a chest in a slot.
    expect(run([{ name: "result.campaign", args: [1, true, 3] }], t0)).toEqual([]);
    const first = coins();
    expect(first).toBeGreaterThan(100);
    expect(rec.save.campaign[1]).toBe(3);
    expect((rec.save as AnySave).chests.slots.filter(Boolean)).toHaveLength(1);
    // Straight away again: battles take longer than that.
    expect(run([{ name: "result.campaign", args: [2, true, 3] }], t0 + 3000)).toEqual(["result.campaign: Too soon after the last battle"]);
    expect(coins()).toBe(first);
    // Later, a replay of level 1 pays replay coins, far less than a first clear.
    expect(run([{ name: "result.campaign", args: [1, true, 3] }], t0 + 30_000)).toEqual([]);
    expect(coins() - first).toBeLessThan(first / 2);
    // The Gauntlet pays rivals in order, one run at a time.
    expect(run([{ name: "result.gauntlet", args: [4] }], t0 + 60_000)).toEqual(["result.gauntlet: That is not the rival this run has reached"]);
    expect(run([{ name: "gauntlet.begin", args: [] }, { name: "result.gauntlet", args: [1] }], t0 + 60_000)).toEqual([]);
    expect(rec.save.gauntlet).toMatchObject({ best: 1, at: 2 });
    // Spending is checked: no gems, no bundle, no skin.
    const before = JSON.stringify(rec.save.wallet);
    expect(run([{ name: "shop.coins", args: ["nope"] }], t0 + 61_000)).toHaveLength(1);
    run([{ name: "shop.coins", args: ["coins.l"] }, { name: "skins.buy", args: ["keep:shadow"] }, { name: "pass.skip", args: [] }], t0 + 61_000);
    expect(JSON.stringify(rec.save.wallet)).toBe(before);
    expect((rec.save as AnySave).cosmetics?.owned ?? ["keep:meadow"]).toEqual(["keep:meadow"]);
  });

  it("a device and the server run the same actions to the same account, chest rolls included", () => {
    const { hub, id } = mk();
    const st = hub.solo(id, new Date().getTimezoneOffset());
    // The device: the server's save and seeds, and a sink that collects what it does.
    adoptSave(st.save as never, "test");
    const seeds = [...st.seeds];
    const sent: Acct.OpCall[] = [];
    const device = () => { setSeedSource(() => seeds.shift()!); setOpSink((name, args) => sent.push({ name, args })); };
    device();
    const won = campaignResult(1, true, 3);
    expect(won.chest?.chest).toBeTruthy();
    startUnlock(0);
    const mine = load() as AnySave;
    const local = { coins: mine.wallet.coins, found: [...mine.collection.found], cards: { ...mine.collection.cards }, chest: mine.chests.slots[0].seed, stars: mine.campaign[1], xp: mine.progression.xp };
    setOpSink(null);
    expect(sent.map((o) => o.name)).toEqual(["result.campaign", "chests.start"]); // the pieces inside an action are not reported
    const reply = hub.soloOps(id, sent);
    expect(reply.rejected).toEqual([]);
    const s = reply.save as AnySave;
    expect({ coins: s.wallet.coins, found: s.collection.found, cards: s.collection.cards, chest: s.chests.slots[0].seed, stars: s.campaign[1], xp: s.progression.xp }).toEqual(local);
    expect(s.chests.slots[0].readyAt).toBeGreaterThan(Date.now());
    // The chest is not ready: opening it now does nothing on the server, whatever a device shows.
    expect(hub.soloOps(id, [{ name: "chests.open", args: [0] }]).save).toMatchObject({ chests: { slots: [{ seed: local.chest }, null, null, null] } });
  });

  it("a tampered device gets nothing: the server's copy replaces it", () => {
    const { hub, id } = mk();
    adoptSave(hub.solo(id).save as never, "test2");
    const sent: Acct.OpCall[] = [];
    setOpSink((name, args) => sent.push({ name, args }));
    (load() as AnySave).wallet = { coins: 0, gems: 99_999, earned: { coins: 0, gems: 0 }, spent: { coins: 0, gems: 0 }, txIds: [] };
    (load() as AnySave).collection.cards.ranger = 500;
    expect(buyCoinBundle("coins.l")).toBeTruthy(); // the device believes it
    expect(upgradeTroop("ranger")).toBeTruthy();
    setOpSink(null);
    const reply = hub.soloOps(id, sent);
    const s = reply.save as AnySave;
    expect(s.wallet?.coins ?? 0).toBe(0);
    expect(s.wallet?.gems ?? 0).toBe(0);
    expect(s.progression?.levels?.ranger ?? 1).toBe(1);
    adoptSave(reply.save as never, "test2");
    expect((load() as AnySave).wallet?.gems ?? 0).toBe(0);
  });

  it("upgrades cost what the game's rules say, and count in ranked", () => {
    const { hub, id } = mk();
    const rec = hub.store.account(id);
    (rec.save as AnySave).collection.cards.ranger = 5;
    (rec.save as AnySave).wallet = { coins: 200, gems: 0, earned: { coins: 200, gems: 0 }, spent: { coins: 0, gems: 0 }, txIds: [] };
    hub.store.saveAccount(id, rec);
    const a = hub.upgrade(id, "ranger");
    const ranger = a.units.find((u) => u.kind === "ranger")!;
    expect(ranger.level).toBe(2);
    expect(ranger.cards).toBe(5 - upgradeCards(1, "common"));
    expect(a.coins).toBe(200 - upgradeCoins(1, "common"));
    expect(hub.upgrade(id, "golem").coins).toBe(a.coins); // not found: nothing happens
    expect(() => hub.upgrade(id, "dragon")).toThrow();
    const b = hub.register("B", "web").me;
    for (const p of [id, b.id]) hub.connect(hub.store.player(p)!, { send: () => {} });
    hub.joinQueue(id); hub.joinQueue(b.id);
    expect(hub.matchView(b.id)!.levels?.[0]?.ranger).toBe(2);
    expect(hub.matchView(b.id)!.levels?.[1]).toBeUndefined();
  });

  it("ranked rewards: full pay for the first wins of a day, then a trickle", () => {
    const rec = Acct.newRecord();
    let n = 0;
    const rand = () => ((n++ * 37) % 100) / 100;
    const first = Acct.matchReward(rec, { won: true, league: 1, day: "2026-11-18", rand });
    expect(first.coins).toBe(55);
    expect(first.cards).toHaveLength(2);
    expect(rec.save.wallet!.coins).toBe(55);
    for (let i = 1; i < Acct.DAILY_WINS; i++) Acct.matchReward(rec, { won: true, league: 1, day: "2026-11-18", rand });
    expect(Acct.matchReward(rec, { won: true, league: 1, day: "2026-11-18", rand })).toEqual({ coins: 10, cards: [] });
    expect(Acct.matchReward(rec, { won: true, league: 1, day: "2026-11-19", rand }).cards).toHaveLength(2);
    expect(Acct.matchReward(rec, { won: false, league: 1, day: "2026-11-19", rand })).toEqual({ coins: 10, cards: [] });
  });
});

describe("money: Stripe", () => {
  let app: App, base: string, token: string, id: string;
  const asked: { url: string; auth: string; form: URLSearchParams }[] = [];
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "http://game.test", ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    return { status: r.status, data: await r.json() };
  };
  /** A webhook as Stripe signs it. */
  const hook = (event: object, secret = "whsec_test", t = Math.floor(Date.now() / 1000)) => {
    const text = JSON.stringify(event);
    return call("POST", "/v1/stripe/webhook", text, { "stripe-signature": `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${text}`).digest("hex")}` });
  };
  const paidEvent = (sessionId: string, product: string, amount: number, o: Record<string, unknown> = {}) => ({
    type: "checkout.session.completed",
    data: { object: { id: sessionId, payment_status: "paid", amount_total: amount, currency: "usd", metadata: { player: id, product }, ...o } },
  });
  const gems = async () => ((await call("GET", "/v1/account")).data.gems as number);
  const sack = GEM_PACKS.find((p) => p.gems === 450)!;

  beforeAll(async () => {
    app = createApp({
      ratePerSec: 0, registerPerHour: 0, adminKey: "k", stripeKey: "sk_test_x", stripeWebhookSecret: "whsec_test",
      stripeFetch: async (url, init) => { asked.push({ url, auth: init.headers.authorization, form: new URLSearchParams(init.body) }); return { ok: true, status: 200, json: async () => ({ id: `cs_test_${asked.length}`, url: `https://checkout.stripe.test/${asked.length}` }) }; },
    });
    await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
    const r = await (await fetch(base + "/v1/register", { method: "POST", body: JSON.stringify({ name: "Buyer" }) })).json();
    token = r.token; id = r.me.id;
  });
  afterAll(() => app.close());

  it("checkout: the server names the price and the player; nothing is credited yet", async () => {
    const store = (await call("GET", "/v1/store")).data;
    expect(store.payments).toBe(true);
    expect(store.products.find((p: { id: string }) => p.id === sack.id)).toMatchObject({ usd: 4.99 });
    const r = await call("POST", "/v1/store/checkout", { product: sack.id, price: 0.01 });
    expect(r.data.url).toBe("https://checkout.stripe.test/1");
    const f = asked[0].form;
    expect(asked[0].auth).toBe("Bearer sk_test_x");
    expect(f.get("line_items[0][price_data][unit_amount]")).toBe("499"); // the server's price, not the client's
    expect(f.get("metadata[player]")).toBe(id);
    expect(f.get("metadata[product]")).toBe(sack.id);
    expect(f.get("success_url")).toBe("http://game.test/?tab=shop&paid=1");
    expect(await gems()).toBe(0);
    expect((await call("POST", "/v1/store/checkout", { product: "free-money" })).status).toBe(400);
  });

  it("webhook: only Stripe's signature credits, once per payment, at the server's price", async () => {
    const ev = paidEvent("cs_test_0001", sack.id, 499);
    expect((await hook(ev, "whsec_wrong")).status).toBe(401);
    expect((await call("POST", "/v1/stripe/webhook", ev)).status).toBe(401);
    expect((await hook(ev, "whsec_test", Math.floor(Date.now() / 1000) - 3600)).status).toBe(401); // an old capture replayed
    expect(await gems()).toBe(0);
    expect((await hook(ev)).data).toMatchObject({ credited: true });
    expect((await hook(ev)).data).toMatchObject({ credited: false }); // Stripe retries: no second payout
    expect(await gems()).toBe(450);
    // Unpaid, underpaid or for a product that does not exist: nothing.
    expect((await hook(paidEvent("cs_test_0002", sack.id, 499, { payment_status: "unpaid" }))).data).toMatchObject({ ignored: true });
    expect((await hook(paidEvent("cs_test_0003", GEM_PACKS.at(-1)!.id, 499))).data).toMatchObject({ credited: false });
    expect((await hook(paidEvent("cs_test_0004", "nope", 499))).data).toMatchObject({ credited: false });
    expect((await hook({ type: "charge.succeeded", data: { object: {} } })).data).toMatchObject({ ignored: true });
    expect(await gems()).toBe(450);
    expect(app.store.purchases(id).map((p) => [p.tx, p.source])).toEqual([["cs_test_0001", "stripe"]]);
    // The gems are real: the device's mirror shows them, and they spend through the normal actions.
    const st: SoloState = (await call("GET", "/v1/solo?tz=0")).data;
    expect((st.save as AnySave).wallet.gems).toBe(450);
    const after = (await call("POST", "/v1/solo/ops", { ops: [{ name: "shop.coins", args: ["coins.m"] }] })).data;
    expect(after.rejected).toEqual([]);
    expect(after.save.wallet.gems).toBeLessThan(450);
    expect(after.save.wallet.coins).toBeGreaterThan(0);
  });

  it("the Starter Pack sells once", async () => {
    const starter = (await call("GET", "/v1/store")).data.products.find((p: { id: string }) => p.id === STARTER);
    expect((await call("POST", "/v1/store/checkout", { product: STARTER })).status).toBe(200);
    const before = await gems();
    expect((await hook(paidEvent("cs_test_0010", STARTER, Math.round(starter.usd * 100)))).data.credited).toBe(true);
    expect(await gems()).toBeGreaterThan(before);
    const r = await call("POST", "/v1/store/checkout", { product: STARTER });
    expect(r).toMatchObject({ status: 400, data: { error: "You already have the Starter Pack" } });
  });

  it("without a Stripe key nothing is for sale, and the admin key alone can grant", async () => {
    const plain = createApp({ ratePerSec: 0, registerPerHour: 0 });
    await new Promise<void>((r) => plain.server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(plain.server.address() as AddressInfo).port}`;
    const reg = await (await fetch(url + "/v1/register", { method: "POST", body: JSON.stringify({ name: "X" }) })).json();
    const r = await fetch(url + "/v1/store/checkout", { method: "POST", headers: { authorization: `Bearer ${reg.token}`, "content-type": "application/json" }, body: JSON.stringify({ product: sack.id }) });
    expect(r.status).toBe(503);
    expect((await fetch(url + "/v1/stripe/webhook", { method: "POST", body: "{}" })).status).toBe(404);
    await plain.close();
    expect((await call("POST", "/v1/admin/grant", { player: id, gems: 50 })).status).toBe(404);
    const g = await call("POST", "/v1/admin/grant", { player: id, gems: 50, note: "prize" }, { "x-admin-key": "k" });
    expect(g.data.account.gems).toBe((await gems()));
  });
});

// Keep the linter honest about helpers only some tests use.
void openReady; void grantChest;
