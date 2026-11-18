// What a finished battle in the solo modes changes: stars, coins, cards, chests, streaks. Each is one action
// (src/sync.ts), so online the server pays it from its own tables, once, in order, and no faster than battles can be
// fought. The server cannot watch a solo fight, so these are bounded rather than proven: a level pays its first clear
// once and only after the level before it, replays and Skirmish sit under their daily caps, the Gauntlet pays each
// rival of a run in turn, and results must be spaced out (the `gap` on each).
import { LEVELS } from "../core/campaign";
import { puzzleStars } from "../core/content";
import { beginDaily, dateKey, finishDaily, type DailyResult } from "../core/daily";
import { PUZZLES } from "../core/puzzles";
import { RALLY_GEMS } from "../economy/gems";
import { earn, spend } from "../economy/wallet";
import { load, save } from "../save";
import { Refused, bool, int, none, op, wallNow } from "../sync";
import { winChest, type WinResult } from "./chests";
import type { Reward } from "./economy";
import { passEvent } from "./passEvents";
import { awardCampaign, awardDaily, awardGauntletRival, awardSkirmish } from "./troops";

const no = (why: string): never => { throw new Refused(why); };

/** A campaign battle ended: pays it, keeps the best stars, drops a chest on a win. */
export const campaignResult = op("result.campaign", (id: number, won: boolean, stars: number): { coins: Reward; chest: WinResult | null } => {
  const l = LEVELS.find((x) => x.id === id)!;
  const n = won ? stars : 0;
  const coins = awardCampaign(l, won, n); // before the star save, to see a first clear
  if (n > (load().campaign[id] ?? 0)) save((s) => { s.campaign[id] = n; });
  return { coins, chest: won ? winChest(n) : null };
}, (r): [number, boolean, number] => {
  const id = int(r[0], 1, 9999), c = load().campaign;
  if (!LEVELS.some((x) => x.id === id)) no("No such level");
  if (id !== 1 && !((c[id - 1] ?? 0) > 0)) no("That level is not open yet");
  return [id, bool(r[1]), int(r[2], 0, 3)];
}, { result: true, gap: 20 });

/** A Breakpoint puzzle ended. */
export const puzzleResult = op("result.puzzle", (id: number, won: boolean, gold: number): number => {
  const p = PUZZLES.find((x) => x.id === id)!;
  const n = puzzleStars(p, won, gold);
  if (n > (load().puzzles[id] ?? 0)) save((s) => { s.puzzles[id] = n; });
  return n;
}, (r): [number, boolean, number] => {
  const id = int(r[0], 1, 9999), i = PUZZLES.findIndex((x) => x.id === id);
  if (i < 0) no("No such puzzle");
  if (i > 0 && !((load().puzzles[PUZZLES[i - 1].id] ?? 0) > 0)) no("That puzzle is not open yet");
  return [id, bool(r[1]), int(r[2], 0, 999)];
}, { result: true, gap: 4 });

/** A new Gauntlet run. */
export const gauntletBegin = op("gauntlet.begin", () => save((s) => { s.gauntlet.runs++; s.gauntlet.at = 1; }), none);
/** A Gauntlet rival fell (rival number `stage` of this run): coins, a chest, the best run. */
export const gauntletRival = op("result.gauntlet", (stage: number): { coins: Reward; chest: WinResult } => {
  save((s) => { s.gauntlet.at = stage + 1; if (stage > s.gauntlet.best) s.gauntlet.best = stage; });
  return { coins: awardGauntletRival(stage), chest: winChest(2) };
}, (r): [number] => {
  const stage = int(r[0], 1, 999);
  if (stage !== (load().gauntlet.at ?? 1)) no("That is not the rival this run has reached");
  return [stage];
}, { result: true, gap: 20 });
/** Gauntlet Rally: gems to fight on after a lost run. */
export const payRally = op("gauntlet.rally", () => spend("gems", RALLY_GEMS, "gauntlet:rally"), none);

/** The scored Daily attempt starts. */
export const dailyBegin = op("daily.begin", (key: string) => save((s) => { beginDaily(s.daily, key); }), (): [string] => [dateKey(wallNow())]);
/** A Daily battle ended (the scored attempt, or practice). */
export const dailyDone = op("result.daily", (key: string, practice: boolean, won: boolean, score: number): { coins: Reward; scored: boolean } => {
  let scored = false;
  if (!practice) save((s) => { scored = finishDaily(s.daily, key, { won, score }); });
  const coins = awardDaily(won, scored, load().daily.streak);
  passEvent({ kind: "play", mode: "daily" });
  return { coins, scored };
}, (r): [string, boolean, boolean, number] => {
  const won = bool(r[2]);
  // The score's range follows from the rules (src/core/daily.ts): a win is 1000 and up, a loss under 1000.
  return [dateKey(wallNow()), bool(r[1]), won, won ? int(r[3], 1000, 2000) : int(r[3], 0, 999)];
}, { result: true, gap: 20 });
export type { DailyResult };

/** A Skirmish ended. */
export const skirmishResult = op("result.skirmish", (won: boolean, watch: boolean, difficulty: number, hp0: number, hp1: number): { coins: Reward; chest: WinResult | null } => {
  const coins = awardSkirmish(won, watch, difficulty, [hp0, hp1]);
  return { coins, chest: won && !watch ? winChest(2) : null };
}, (r): [boolean, boolean, number, number, number] => {
  const d = typeof r[2] === "number" && r[2] >= 0 && r[2] <= 1 ? r[2] : no("Bad difficulty");
  return [bool(r[0]), bool(r[1]), d, int(r[3], 50, 800), int(r[4], 50, 800)];
}, { result: true, gap: 20 });

/** Bastion coins: a little per wave held, more for a win. */
export const COINS_PER_WAVE = 2;
export const coinsForWin = (stars: number) => 20 + stars * 10;
/** A Bastion run ended: the coins for the waves it held and the win, and a chest on a win. */
export const bastionResult = op("result.bastion", (won: boolean, stars: number, waves: number): { chest: WinResult | null } => {
  const coins = waves * COINS_PER_WAVE + (won ? coinsForWin(stars) : 0);
  if (coins > 0) earn("coins", coins, `bastion ${waves} waves${won ? ` win ${stars}` : ""}`);
  passEvent({ kind: "play", mode: "bastion" });
  return { chest: won ? winChest(stars) : null };
}, (r): [boolean, number, number] => [bool(r[0]), int(r[1], 0, 3), int(r[2], 0, 40)], { result: true, gap: 30 });
