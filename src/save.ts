// Progress on this device.
import { blankDaily, type DailySave } from "./core/daily";
import type { Entitlement } from "./store/entitlement";
import type { WalletSave } from "./economy/wallet";
import type { RewardSave } from "./economy/gems";

export interface Save {
  campaign: Record<number, number>; // level id -> best stars
  puzzles: Record<number, number>;
  gauntlet: { best: number; runs: number };
  daily: DailySave;
  settings: { sound: boolean; haptics: boolean; speed: number };
  seen: string[]; // unit kinds seen in a shop (NEW badge)
  lab?: unknown;
  /** The Full Army unlock as last confirmed (cached so the game opens offline). */
  store?: Entitlement;
  /** Coins and gems (src/economy/wallet.ts). Older saves have none; the wallet fills it in. */
  wallet?: WalletSave;
  /** Free gem rewards already paid (src/economy/gems.ts). */
  rewards?: RewardSave;
}

const KEY = "muster.save.v1";
const blank = (): Save => ({ campaign: {}, puzzles: {}, gauntlet: { best: 0, runs: 0 }, daily: blankDaily(), settings: { sound: true, haptics: true, speed: 1 }, seen: [] });

let cache: Save | null = null;
export function load(): Save {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const b = blank(), got = JSON.parse(raw);
      cache = { ...b, ...got, daily: { ...b.daily, ...got?.daily } };
    } else cache = blank();
  } catch {
    cache = blank();
  }
  return cache!;
}
export function save(mut?: (s: Save) => void) {
  const s = load();
  mut?.(s);
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private mode */ }
}
export function resetSave() {
  cache = blank();
  save();
}
