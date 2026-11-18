// A player's economy, kept by the server: coins, gems, cards, troop levels. Nothing a client says changes it directly.
// Money comes in only through a verified payment (server/app.ts) and play rewards the server itself rolls; it goes out
// only through the rules in src/progression/economy.ts, checked here. How the game looks and what a player calls
// themselves is theirs to change; this is not.
import { UNIT_KINDS, type UnitKind } from "../src/core/defs";
import { clampLevel, type Levels } from "../src/core/levels";
import { GEM_PACKS } from "../src/economy/gems";
import { RARITY, type Rarity } from "../src/progression/collection";
import { STARTER_KINDS, commanderLevel, upgradeState, upgradeXp } from "../src/progression/economy";
import type { AccountView, MatchReward, Product } from "../src/net/protocol";

export interface Account {
  coins: number;
  gems: number;
  /** Spare cards per unit. */
  cards: Partial<Record<UnitKind, number>>;
  found: UnitKind[];
  levels: Levels;
  xp: number;
  /** Ranked wins rewarded today (full rewards stop at DAILY_WINS). */
  day: string;
  wins: number;
}

export class AccountError extends Error {}
const no = (msg: string): never => { throw new AccountError(msg); };

export const DAILY_WINS = 10;
export const newAccount = (): Account => ({ coins: 200, gems: 0, cards: {}, found: [...STARTER_KINDS], levels: {}, xp: 0, day: "", wins: 0 });

/** What real money buys (priced in USD, credited only by a verified payment) and what gems buy (checked here). */
export const PRODUCTS: Product[] = [
  ...GEM_PACKS.map((p) => ({ sku: p.id.split(".").pop()!, name: p.name, usd: p.usd, gives: { gems: p.gems } })),
  { sku: "coins-purse", name: "Purse of coins", gems: 100, gives: { coins: 1000 } },
  { sku: "coins-chest", name: "Chest of coins", gems: 450, gives: { coins: 5000 } },
  { sku: "coins-vault", name: "Vault of coins", gems: 1000, gives: { coins: 12000 } },
];
const product = (sku: unknown) => PRODUCTS.find((p) => p.sku === sku) ?? no("No such product");

export function view(a: Account): AccountView {
  const commander = commanderLevel(a.xp);
  return {
    coins: a.coins, gems: a.gems, xp: a.xp, commander,
    units: UNIT_KINDS.filter((k) => a.found.includes(k)).map((k) => {
      const s = upgradeState(k, { levels: a.levels, found: true, cards: a.cards[k] ?? 0, coins: a.coins, commander });
      return { kind: k, rarity: s.rarity, level: s.level, cards: s.cards, need: Number.isFinite(s.need) ? s.need : null, cost: Number.isFinite(s.cost) ? s.cost : null, why: s.why };
    }),
  };
}

/** Buys a unit's next level with cards and coins, by the game's own rules. */
export function upgrade(a: Account, kind: unknown) {
  if (!UNIT_KINDS.includes(kind as UnitKind)) no("No such unit");
  const k = kind as UnitKind;
  const s = upgradeState(k, { levels: a.levels, found: a.found.includes(k), cards: a.cards[k] ?? 0, coins: a.coins, commander: commanderLevel(a.xp) });
  if (s.why) no({ locked: "You have not found that unit", max: "Already at the top level", cap: "Raise your commander level first", cards: "Not enough cards", coins: "Not enough coins" }[s.why]);
  a.coins -= s.cost;
  a.cards[k] = (a.cards[k] ?? 0) - s.need;
  a.levels[k] = clampLevel(s.level + 1);
  a.xp += upgradeXp(s.level + 1);
}

function give(a: Account, g: Product["gives"]) {
  a.coins += g.coins ?? 0;
  a.gems += g.gems ?? 0;
}
/** A gem-priced product: the gems must be there. */
export function buyWithGems(a: Account, sku: unknown) {
  const p = product(sku);
  if (p.gems === undefined) no("That one is bought with money, not gems");
  if (a.gems < p.gems!) no("Not enough gems");
  a.gems -= p.gems!;
  give(a, p.gives);
  return p;
}
/** A money product, once its payment is verified (the caller makes sure each transaction is credited only once). */
export function creditPaid(a: Account, sku: unknown) {
  const p = product(sku);
  if (p.usd === undefined) no("That one is bought with gems, not money");
  give(a, p.gives);
  return p;
}

const DROP: [Rarity, number, (league: number) => number][] = [
  ["common", 60, (l) => 6 + 2 * l], ["rare", 28, (l) => 2 + l], ["epic", 10, () => 1], ["legendary", 2, () => 1],
];
function grant(a: Account, k: UnitKind, n: number) {
  if (!a.found.includes(k)) { a.found.push(k); n--; }
  if (n > 0) a.cards[k] = (a.cards[k] ?? 0) + n;
}
/** What a ranked match pays, rolled here. The first DAILY_WINS wins of a day pay coins and cards; after that, a little coin. */
export function matchReward(a: Account, o: { won: boolean; league: number; day: string; rand: () => number }): MatchReward {
  if (a.day !== o.day) { a.day = o.day; a.wins = 0; }
  const cards: [UnitKind, number][] = [];
  let coins = 8 + 2 * o.league;
  if (o.won) {
    const full = a.wins < DAILY_WINS;
    a.wins++;
    coins = full ? 40 + 15 * o.league : 10;
    for (let i = 0; full && i < 2; i++) {
      let r = o.rand() * DROP.reduce((n, d) => n + d[1], 0);
      const [rarity, , count] = DROP.find((d) => (r -= d[1]) < 0) ?? DROP[0];
      const pool = UNIT_KINDS.filter((k) => RARITY[k] === rarity);
      const kind = pool[Math.floor(o.rand() * pool.length)];
      const n = count(o.league);
      grant(a, kind, n);
      cards.push([kind, n]);
    }
  }
  a.coins += coins;
  return { coins, cards };
}
