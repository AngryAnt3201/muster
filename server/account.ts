// A player's account, kept by the server: the whole of what they own and have done (coins, gems, cards, troop levels,
// chests, the War Pass, campaign stars...). It is the game's own save, held here, and the game's own rules change it:
// every economy action a client reports (src/sync.ts) is run again on this copy, after its guard, with the server's
// clock and the server's dice. The device shows a mirror of it. Money comes in only through a verified payment.
// How the game looks and what a player calls themselves is theirs to change; this is not.
import { createHmac, randomBytes } from "node:crypto";
import { UNIT_KINDS, type UnitKind } from "../src/core/defs";
import type { Levels } from "../src/core/levels";
import { GEM_PACKS, gemsFor } from "../src/economy/gems";
import "../src/economy/rewards";
import { creditPurchase, earn } from "../src/economy/wallet";
import type { AccountView, MatchReward, Product, SoloState } from "../src/net/protocol";
import { findable, initChests, makeChest } from "../src/progression/chests";
import { RARITY, cardsOf, foundKinds, grantCards, type Rarity } from "../src/progression/collection";
import "../src/progression/cosmetics";
import { commanderLevel, upgradeState } from "../src/progression/economy";
import { creditPremium, premiumActive, queueChest, startPass } from "../src/progression/pass";
import "../src/progression/results";
import { commanderXp, migrateArmy, troopLevels } from "../src/progression/troops";
import { LOCAL_FIELDS, blankSave, load, save, withSave, type Save } from "../src/save";
import { MOCK_PRODUCTS } from "../src/store/mock";
import { activeOffers, creditOfferIn, intendIn, normalizeOffers, offerBought, offerPayout, type OfferSave } from "../src/store/offers";
import { markStarter, payStarter, starterBought } from "../src/store/starter";
import { PASS, STARTER } from "../src/store/types";
import { Refused, opInfo, runOp, setSeedSource, setWallClock } from "../src/sync";

export interface AccountMeta {
  /** The player's timezone as minutes behind UTC (JS getTimezoneOffset), for their day: quests, deals, daily caps. */
  tz: number;
  tzAt: number;
  /** Rolls made so far: the next seed is the server's secret hashed with this. */
  seeds: number;
  /** When the last battle result was accepted. */
  lastResult: number;
  /** Ranked wins rewarded today. */
  rankDay: string;
  rankWins: number;
}
export interface AccountRecord { save: Save; meta: AccountMeta; }

export class AccountError extends Error {}
const no = (msg: string): never => { throw new AccountError(msg); };
export const DAILY_WINS = 10;
const TZ_CHANGE_MS = 7 * 86_400_000;
const SEEDS_AHEAD = 8;

// The pass and quest listeners (wins feed pass XP, play feeds quests) run on whichever save is current.
withSave(blankSave(), () => startPass());

/** Hashes the server's secret with a player and a counter into a seed: the client cannot choose it, only receive it. */
export class Dice {
  constructor(private secret = randomBytes(32).toString("hex")) {}
  at(player: string, i: number) { return createHmac("sha256", this.secret).update(`${player}:${i}`).digest().readUInt32BE(0); }
}

export function newRecord(now = Date.now()): AccountRecord {
  const s = blankSave();
  // A new account as the game makes one: the starter units found, the free chest's clock started.
  withSave(s, () => { migrateArmy(); initChests(); });
  return { save: s, meta: { tz: 0, tzAt: 0, seeds: 0, lastResult: 0, rankDay: "", rankWins: 0 } };
}

/** Runs `fn` with this account as the game's save, the player's wall clock and the server's dice. */
export function session<T>(rec: AccountRecord, player: string, dice: Dice, fn: () => T, now = Date.now()): T {
  const shift = (new Date(now).getTimezoneOffset() - rec.meta.tz) * 60_000;
  setWallClock(() => new Date(Date.now() + shift));
  setSeedSource(() => dice.at(player, rec.meta.seeds++));
  try { return withSave(rec.save, fn); } finally {
    setWallClock(() => new Date());
    setSeedSource(() => (Math.random() * 2 ** 32) >>> 0);
  }
}

/** The player's device says which timezone it is in. Kept; changed at most once a week, so a day cannot be replayed. */
export function setTz(rec: AccountRecord, tz: unknown, now = Date.now()) {
  if (typeof tz !== "number" || !Number.isInteger(tz) || tz < -840 || tz > 720 || tz === rec.meta.tz) return;
  if (rec.meta.tzAt && now - rec.meta.tzAt < TZ_CHANGE_MS) return;
  rec.meta.tz = tz; rec.meta.tzAt = now;
}

/** What the device mirrors: the account (without the fields a device keeps for itself) and the next seeds. */
export function state(rec: AccountRecord, player: string, dice: Dice): SoloState {
  const copy: Record<string, unknown> = { ...rec.save };
  for (const f of LOCAL_FIELDS) delete copy[f];
  return { save: copy, seeds: Array.from({ length: SEEDS_AHEAD }, (_, i) => dice.at(player, rec.meta.seeds + i)), now: Date.now() };
}

export interface OpCall { name: string; args: unknown[]; }
/** Runs a client's actions in order. One that is not allowed is skipped and named; the rest still run. */
export function runOps(rec: AccountRecord, player: string, dice: Dice, ops: OpCall[], now = Date.now()) {
  const rejected: { i: number; name: string; why: string }[] = [];
  session(rec, player, dice, () => {
    ops.forEach((o, i) => {
      const name = String(o?.name ?? ""), info = opInfo(name);
      try {
        if (!info) throw new Refused("Unknown action");
        if (info.result && now - rec.meta.lastResult < info.gap * 1000) throw new Refused("Too soon after the last battle");
        runOp(name, o.args);
        if (info.result) rec.meta.lastResult = now;
      } catch (e) {
        if (!(e instanceof Refused)) console.error(`action ${name} failed`, e);
        rejected.push({ i, name, why: e instanceof Refused ? e.message : "Failed" });
      }
    });
  }, now);
  return rejected;
}

// ------------------------------------------------------------ views
export function view(rec: AccountRecord): AccountView {
  return withSave(rec.save, () => {
    const w = load().wallet ?? { coins: 0, gems: 0 }, levels = troopLevels(), xp = commanderXp(), commander = commanderLevel(xp);
    return {
      coins: w.coins, gems: w.gems, xp, commander,
      units: UNIT_KINDS.filter((k) => foundKinds().includes(k)).map((k) => {
        const s = upgradeState(k, { levels, found: true, cards: cardsOf(k), coins: w.coins, commander });
        return { kind: k, rarity: s.rarity, level: s.level, cards: s.cards, need: Number.isFinite(s.need) ? s.need : null, cost: Number.isFinite(s.cost) ? s.cost : null, why: s.why };
      }),
    };
  });
}
/** The troop levels a player brings to a ranked match. */
export function levels(rec: AccountRecord): Levels | undefined {
  const l = withSave(rec.save, () => troopLevels());
  return Object.values(l).some((v) => (v ?? 1) > 1) ? l : undefined;
}

// ------------------------------------------------------------ ranked rewards
const DROP: [Rarity, number, (league: number) => number][] = [
  ["common", 60, (l) => 6 + 2 * l], ["rare", 28, (l) => 2 + l], ["epic", 10, () => 1], ["legendary", 2, () => 1],
];
/** What a ranked match pays, rolled here. The first DAILY_WINS wins of a day pay coins and cards; after that, a little coin. */
export function matchReward(rec: AccountRecord, o: { won: boolean; league: number; day: string; rand: () => number }): MatchReward {
  const m = rec.meta;
  if (m.rankDay !== o.day) { m.rankDay = o.day; m.rankWins = 0; }
  const cards: [UnitKind, number][] = [];
  let coins = 8 + 2 * o.league;
  if (o.won) {
    const full = m.rankWins < DAILY_WINS;
    m.rankWins++;
    coins = full ? 40 + 15 * o.league : 10;
    for (let i = 0; full && i < 2; i++) {
      let r = o.rand() * DROP.reduce((n, d) => n + d[1], 0);
      const [rarity, , count] = DROP.find((d) => (r -= d[1]) < 0) ?? DROP[0];
      const pool = UNIT_KINDS.filter((k) => RARITY[k] === rarity);
      cards.push([pool[Math.floor(o.rand() * pool.length)], count(o.league)]);
    }
  }
  withSave(rec.save, () => {
    earn("coins", coins, "ranked");
    for (const [k, n] of cards) grantCards(k, n, "ranked");
  });
  return { coins, cards };
}

// ------------------------------------------------------------ money
/** Everything sold for money, at the server's prices (USD). */
export const PRODUCTS: Product[] = MOCK_PRODUCTS.map((p) => ({ id: p.id, title: p.title, description: p.description, usd: p.price ?? Number(p.displayPrice.replace(/[^0-9.]/g, "")) }));
export const product = (id: unknown) => PRODUCTS.find((p) => p.id === id) ?? no("No such product");
type WithOffers = Save & { offers?: OfferSave };
const offers = <T>(f: (o: OfferSave) => T): T => {
  let out!: T;
  save((s) => { const w = s as WithOffers; w.offers = normalizeOffers(w.offers); out = f(w.offers); });
  return out;
};

/** Before sending a player to pay: is this theirs to buy? (`offer` names which special offer a tier purchase is for.) */
export function intend(rec: AccountRecord, productId: unknown, offer: unknown, now = Date.now()): Product {
  const p = product(productId);
  withSave(rec.save, () => {
    if (p.id === STARTER && starterBought(load())) no("You already have the Starter Pack");
    if (p.id === PASS && premiumActive()) no("War Pass Premium is already active this season");
    if (!GEM_PACKS.some((g) => g.id === p.id) && p.id !== STARTER && p.id !== PASS) {
      const o = activeOffers(now).find((x) => x.id === offer && x.productId === p.id) ?? no("That offer has ended");
      if (offers((s) => offerBought(s, o.id))) no("You already have this offer");
      offers((s) => intendIn(s, o));
    }
  });
  return p;
}

/** Pays out a product whose payment is verified. The caller makes sure each transaction reaches here once; the
 *  game's own transaction marks are a second lock. Returns whether anything was paid. */
export function credit(rec: AccountRecord, productId: unknown, txId: string, now = Date.now()): boolean {
  const p = product(productId);
  return withSave(rec.save, () => {
    if (GEM_PACKS.some((g) => g.id === p.id)) return creditPurchase(txId, gemsFor(p.id));
    if (p.id === STARTER) {
      return payStarter(txId, {
        creditGems: creditPurchase, earnCoins: (n) => void earn("coins", n, "starter"),
        grantCards: (k, n) => void grantCards(k, n, "starter"), markBought: (tx) => save((s) => { markStarter(s, tx); }),
      });
    }
    if (p.id === PASS) return creditPremium(txId) !== "dup";
    const o = offers((s) => creditOfferIn(s, txId, p.id, now));
    if (!o) return false;
    const pay = offerPayout(o, findable(load().campaign, foundKinds()));
    earn("gems", pay.gems, `offer ${o.id}`);
    earn("coins", pay.coins, `offer ${o.id}`);
    if (pay.cards) grantCards(pay.cards.kind, pay.cards.n, `offer ${o.id}`);
    queueChest(makeChest(pay.chest));
    return true;
  });
}
