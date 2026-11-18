// Free gems, bound to the device save: call settleRewards() after anything that can earn (a result screen,
// the title screen). It pays whatever progress has earned and not been paid yet, once.
import { ACTS, LEVELS } from "../core/campaign";
import { load, save } from "../save";
import { none, oneOf, op } from "../sync";
import { COIN_BUNDLES, claimIn, normalizeRewards, rewardsOwed, type CoinBundle, type EarnCtx, type Reward } from "./gems";
import { earn, spend } from "./wallet";

/** Gems for coins, at the Shop's bundle prices. Returns the bundle, or null when the gems are not there. */
export const buyCoinBundle = op("shop.coins", (id: string): CoinBundle | null => {
  const b = COIN_BUNDLES.find((x) => x.id === id)!;
  if (!spend("gems", b.gems, `coins:${b.id}`)) return null;
  earn("coins", b.coins, `bundle:${b.id}`);
  return b;
}, (r): [string] => [oneOf(r[0], COIN_BUNDLES.map((b) => b.id))]);

const ctx = (): EarnCtx => ({ levels: LEVELS, acts: ACTS.length });

/** Pays every reward owed and returns them (empty when nothing new). */
export const settleRewards = op("rewards.settle", settleRewards_, none);
function settleRewards_(): Reward[] {
  const s = load();
  const owed = rewardsOwed(s, normalizeRewards(s.rewards), ctx());
  if (!owed.length) return [];
  let total = 0;
  save((x) => { x.rewards = normalizeRewards(x.rewards); total = claimIn(x.rewards, owed); });
  if (total > 0) earn("gems", total, `rewards:${owed.map((r) => r.id).join(",")}`);
  return owed;
}
