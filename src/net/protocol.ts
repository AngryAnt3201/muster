// Online play: what the match server and the game say to each other. Shared by server/ and src/net.
// Every coordinate here is in the server's frame: seat 0 deploys at the bottom of the board, seat 1 at the top.
// A seat-1 client turns the board round on its own screen (src/net/mirror.ts), so both players see themselves below.
import type { Piece, UnitKind } from "../core/defs";
import type { Levels } from "../core/levels";

/** Piece ids per seat: each seat numbers its own pieces, so a client knows a bought piece's id without asking. */
export const ID_BASE: [number, number] = [1, 500001];
/** Seconds to deploy in round 1, and in every later round (counted from when both players have watched the battle). */
export const FIRST_DEPLOY_SECS = 60;
export const DEPLOY_SECS = 45;
/** The longest the server waits for a player to finish watching a battle before the deploy clock starts anyway. */
export const WATCH_MAX_SECS = 80;
/** Rounds a player may sit out (no action, no Ready) in a row before the match is forfeit. */
export const MAX_IDLE_ROUNDS = 3;
export const MAX_ROUNDS = 40;
export const NAME_MAX = 16;

export type Seat = 0 | 1;

export type Action =
  | { t: "buy"; slot: number; x: number; y: number }
  | { t: "upgrade"; id: number }
  | { t: "sell"; id: number }
  | { t: "reroll" };

export interface Placement { id: number; x: number; y: number; }

export interface SideView {
  name: string;
  hp: number;
  maxHp: number;
  gold: number;
  shop: (UnitKind | null)[];
  pieces: Piece[];
  rerolls: number;
  /** The id your next bought piece gets. */
  nextId: number;
  lastIncome: { base: number; interest: number; bonus: number };
}

export interface FoeView {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  gold: number;
  /** The rival's board as it stood when the round began: all a player may know before the battle. */
  seen: Piece[];
  ready: boolean;
}

/** One player's view of a match during deploy. */
export interface RoundView {
  matchId: string;
  ranked: boolean;
  seat: Seat;
  round: number;
  /** Actions of yours the server has applied this match (the client's send order). */
  seq: number;
  you: SideView;
  foe: FoeView;
  ready: boolean;
  /** Troop levels by seat (ranked matches use each player's server-held levels; friendlies have none: all level 1). */
  levels?: [Levels | undefined, Levels | undefined];
  /** When deploy ends (epoch ms on the server's clock), or null while the server waits for the battle to be watched. */
  deadline: number | null;
  /** The server's clock when this view was made, to turn `deadline` into a local countdown. */
  now: number;
}

export interface RatingChange { before: number; after: number; }

/** A round's battle, as the server fought it. Clients replay it from the same pieces and seed; the numbers here rule. */
export interface BattleMsg {
  matchId: string;
  round: number;
  pieces: Piece[];
  seed: number;
  levels?: [Levels | undefined, Levels | undefined];
  /** Seat that won the round, or -1. */
  winner: -1 | Seat;
  damage: [number, number];
  hp: [number, number];
  over: boolean;
  /** Seat that won the match (set when `over`). */
  matchWinner: -1 | Seat | null;
  /** The next round's deploy view (null when the match is over). */
  next: RoundView | null;
  rating?: RatingChange;
}

export type EndReason = "hp" | "forfeit" | "timeout";

export interface PlayerCard {
  id: string;
  name: string;
  /** Trophies (src/net/ladder.ts). */
  rating: number;
  /** A scripted player: a house bot, a bot token, or an account the automation checks keep flagging. */
  bot?: boolean;
  wins: number;
  losses: number;
  online?: boolean;
  inMatch?: boolean;
}

export interface Me extends PlayerCard { code: string; }

export interface FriendsView {
  friends: PlayerCard[];
  /** Requests waiting on you. */
  incoming: PlayerCard[];
  /** Requests you sent. */
  outgoing: PlayerCard[];
  /** Challenges waiting on you. */
  challenges: { id: string; from: PlayerCard }[];
}

/** Server pushes (WebSocket). */
export type Push =
  | { t: "hello"; me: Me; queued: boolean; match: RoundView | null }
  | { t: "friends" }
  | { t: "presence"; id: string; online: boolean; inMatch: boolean }
  | { t: "challenge"; id: string; from: PlayerCard }
  | { t: "challenge_gone"; id: string; why: "declined" | "cancelled" | "expired" }
  | { t: "queue"; searching: boolean }
  | { t: "match_found"; view: RoundView }
  | { t: "foe_ready"; matchId: string }
  | { t: "deploy"; matchId: string; round: number; deadline: number; now: number }
  | { t: "battle"; battle: BattleMsg }
  | { t: "match_over"; matchId: string; winner: -1 | Seat; reason: EndReason; rating?: RatingChange; reward?: MatchReward };

/** What a ranked match paid into the player's server account. */
export interface MatchReward { coins: number; cards: [UnitKind, number][]; }

/** A thing to buy: with money (`usd`, credited by a verified payment) or with gems (`gems`). */
export interface Product { sku: string; name: string; usd?: number; gems?: number; gives: { coins?: number; gems?: number }; }

/** A player's server-held economy, as the game shows it. */
export interface AccountView {
  coins: number;
  gems: number;
  xp: number;
  commander: number;
  units: { kind: UnitKind; rarity: string; level: number; cards: number; need: number | null; cost: number | null; why: string | null }[];
}

export interface ApiError { error: string; }
