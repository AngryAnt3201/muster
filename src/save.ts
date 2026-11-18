// Progress on this device.
import { blankDaily, type DailySave } from "./core/daily";
import type { StoreSave } from "./store/starter";
import type { WalletSave } from "./economy/wallet";
import type { RewardSave } from "./economy/gems";
import type { ProgressionSave } from "./progression/troops";
import type { CollectionSave } from "./progression/collection";
import type { ChestSave } from "./progression/chests";
import type { CosmeticsSave } from "./progression/cosmetics";

export interface Save {
  campaign: Record<number, number>; // level id -> best stars
  puzzles: Record<number, number>;
  /** `at`: the rival the current run has reached (the server pays each rival once, in order). */
  gauntlet: { best: number; runs: number; at?: number };
  daily: DailySave;
  settings: { sound: boolean; haptics: boolean; speed: number };
  seen: string[]; // unit kinds seen in a shop (NEW badge)
  lab?: unknown;
  /** Store purchases the game tracks: whether the one-time Starter Pack was bought (src/store/starter.ts). */
  store?: StoreSave;
  /** Coins and gems (src/economy/wallet.ts). Older saves have none; the wallet fills it in. */
  wallet?: WalletSave;
  /** Free gem rewards already paid (src/economy/gems.ts). */
  rewards?: RewardSave;
  /** Troop levels bought with coins (src/progression/troops.ts). Older saves have none: every unit is level 1. */
  progression?: ProgressionSave;
  /** Units found and spare cards held (src/progression/collection.ts). */
  collection?: CollectionSave;
  /** Chest slots, timers, the cycle and the free and crown chests (src/progression/chests.ts). */
  chests?: ChestSave;
  /** Keep skins owned and equipped (src/progression/cosmetics.ts). */
  cosmetics?: CosmeticsSave;
}

const OFFLINE_KEY = "muster.save.v1";
let KEY = OFFLINE_KEY;
/** Fields that stay on the device whoever holds the account: how the game is set up, not what the player owns. */
export const LOCAL_FIELDS = ["settings", "seen", "lab"] as const;
export const blankSave = (): Save => blank();
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
/** Server: runs `fn` with `s` as the save every economy module reads and writes (one player's account), then puts
 *  the device's back. Synchronous only. */
export function withSave<T>(s: Save, fn: () => T): T {
  const prev = cache;
  cache = s;
  try { return fn(); } finally { cache = prev; }
}
/** Online: the server's copy of the account becomes this device's save (kept under its own key, so the offline save
 *  is left as it was). The device's own settings stay. */
export function adoptSave(server: Partial<Save>, key = "muster.save.online") {
  const mine = load();
  const next = { ...blank(), ...server, daily: { ...blank().daily, ...server.daily } } as Save;
  for (const f of LOCAL_FIELDS) (next as unknown as Record<string, unknown>)[f] = (mine as unknown as Record<string, unknown>)[f];
  KEY = key;
  cache = next;
  save();
}
export function resetSave() {
  cache = blank();
  save();
}
