// One online match. The server owns the only real Match: players send what they want to do, the server checks it
// against the rules (gold, board size, deploy zone), fights the battle itself and tells both sides what happened.
// A client never sees the rival's shop, gold spent this round or new pieces before the battle, and never sees a seed
// it could use to predict a shop or a battle.
import { randomInt } from "node:crypto";
import { applyPlan, planTurn, type AIProfile } from "../src/core/ai";
import { clampToZone, UNITS, type Piece, type Side } from "../src/core/defs";
import type { Levels } from "../src/core/levels";
import { Match } from "../src/core/match";
import { Rng } from "../src/core/rng";
import {
  DEPLOY_SECS, FIRST_DEPLOY_SECS, ID_BASE, MAX_IDLE_ROUNDS, MAX_ROUNDS, WATCH_MAX_SECS,
  type Action, type BattleMsg, type EndReason, type Placement, type Push, type RoundView, type Seat,
} from "../src/net/protocol";
import { RoundLog, type SeatTelemetry } from "./telemetry";

const rand32 = () => randomInt(1, 0xffffffff);
/** Slack after the deadline before the server readies a player itself (the client readies at the deadline). */
const GRACE_MS = 2500;

/** A Match whose every shop roll and battle comes from fresh server randomness: nothing a client sees predicts the next. */
export class ServerMatch extends Match {
  private battleSeeds?: Map<number, number>;
  constructor(names: [string, string], levels?: [Levels | undefined, Levels | undefined]) {
    super({ seed: rand32(), names, idBase: ID_BASE, maxRounds: MAX_ROUNDS, ...(levels ? { levels } : {}) });
  }
  protected override rollShop(s: Side) {
    this.shopRng[s] = new Rng(rand32());
    super.rollShop(s);
  }
  override battleSeed() {
    this.battleSeeds ??= new Map();
    let seed = this.battleSeeds.get(this.round);
    if (seed === undefined) this.battleSeeds.set(this.round, (seed = rand32()));
    return seed;
  }
}

export interface RoomPlayer { id: string; name: string; }
export interface RoomExtra {
  /** Troop levels by seat (ranked). */
  levels?: [Levels | undefined, Levels | undefined];
  /** A seat the server plays itself (a house bot). */
  bot?: { seat: Seat; ai: AIProfile };
}
export interface RoomEnd { winner: -1 | Seat; reason: EndReason; rounds: number; telemetry: [SeatTelemetry, SeatTelemetry]; }

export class Room {
  readonly match: ServerMatch;
  readonly started: number;
  over = false;
  private ready: [boolean, boolean] = [false, false];
  private watched: [boolean, boolean] = [true, true];
  private acted: [boolean, boolean] = [false, false];
  private idle: [number, number] = [0, 0];
  private seq: [number, number] = [0, 0];
  private deadline: number | null;
  private watchUntil = 0;
  private logs: [RoundLog, RoundLog];

  constructor(
    readonly id: string,
    readonly players: [RoomPlayer, RoomPlayer],
    readonly ranked: boolean,
    private send: (seat: Seat, msg: Push) => void,
    private onEnd: (room: Room, end: RoomEnd) => void,
    now = Date.now(),
    private extra: RoomExtra = {},
  ) {
    this.match = new ServerMatch([players[0].name, players[1].name], extra.levels);
    this.started = now;
    this.deadline = now + FIRST_DEPLOY_SECS * 1000;
    this.logs = [new RoundLog(now), new RoundLog(now)];
    this.snapGold();
    this.botTurn();
  }

  /** The house bot drafts as the round opens, from the board as it stood then (all a player could know), and is
   *  ready whenever the person is. */
  private botTurn() {
    const b = this.extra.bot;
    if (!b || this.over) return;
    try { applyPlan(this.match, b.seat, planTurn(this.match, b.seat, b.ai)); } catch { /* a plan that does not fit: it stands pat */ }
    this.acted[b.seat] = true;
    this.watched[b.seat] = true;
  }

  seatOf(playerId: string): Seat | -1 {
    return this.players[0].id === playerId ? 0 : this.players[1].id === playerId ? 1 : -1;
  }

  view(seat: Seat, now = Date.now()): RoundView {
    const m = this.match, you = m.sides[seat], foe = m.sides[1 - seat];
    return {
      matchId: this.id, ranked: this.ranked, seat, round: m.round, seq: this.seq[seat],
      you: {
        name: you.name, hp: you.hp, maxHp: you.maxHp, gold: you.gold, shop: [...you.shop],
        pieces: you.pieces.map((p) => ({ ...p })), rerolls: you.rerolls, nextId: m.nextIdFor(seat), lastIncome: { ...you.lastIncome },
      },
      foe: {
        id: this.players[1 - seat].id, name: foe.name, hp: foe.hp, maxHp: foe.maxHp,
        // The rival's purse as the round began: what they spend this round stays hidden until the battle.
        gold: this.foeGold[1 - seat], seen: foe.seen.map((p) => ({ ...p })), ready: this.ready[1 - seat],
      },
      ready: this.ready[seat], ...(m.cfg.levels ? { levels: m.cfg.levels } : {}), deadline: this.deadline, now,
    };
  }
  /** Each side's gold at the start of the round. */
  private foeGold: [number, number] = [0, 0];
  private snapGold() { this.foeGold = [this.match.sides[0].gold, this.match.sides[1].gold]; }

  /** Applies one deploy action. Throws (with the rule broken) on an illegal one; the match is left as it was. */
  act(seat: Seat, a: Action, now = Date.now()) {
    if (this.over) throw Error("Match over");
    if (this.ready[seat]) throw Error("Already ready");
    const m = this.match;
    if (m.phase !== "deploy") throw Error("Not now");
    switch (a?.t) {
      case "buy": {
        if (!Number.isInteger(a.slot) || a.slot < 0 || a.slot >= m.sides[seat].shop.length) throw Error("No such card");
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) throw Error("Bad position");
        m.buy(seat, a.slot, a.x, a.y);
        break;
      }
      case "upgrade": m.upgrade(seat, Number(a.id)); break;
      case "sell": m.sell(seat, Number(a.id)); break;
      case "reroll": m.reroll(seat); break;
      default: throw Error("Unknown action");
    }
    this.seq[seat]++;
    this.acted[seat] = true;
    this.logs[seat].action(now);
  }

  /** A player is done deploying. `placements` are where their pieces now stand (moves are free and sent only here). */
  setReady(seat: Seat, placements: Placement[] | undefined, now = Date.now(), forced = false) {
    if (this.over || this.ready[seat]) return;
    const m = this.match;
    if (Array.isArray(placements)) {
      const mine = new Map(m.sides[seat].pieces.map((p) => [p.id, p]));
      for (const pl of placements.slice(0, 64)) {
        const p = mine.get(Number(pl?.id));
        if (!p || !Number.isFinite(pl.x) || !Number.isFinite(pl.y)) continue;
        const at = clampToZone(seat, pl.x, pl.y, UNITS[p.kind].radius);
        p.x = at.x; p.y = at.y;
      }
    }
    this.ready[seat] = true;
    if (!forced) { this.acted[seat] = true; this.logs[seat].ready(now); }
    this.send((1 - seat) as Seat, { t: "foe_ready", matchId: this.id });
    const bot = this.extra.bot;
    if (bot && seat !== bot.seat && !this.ready[bot.seat]) { this.ready[bot.seat] = true; this.send(seat, { t: "foe_ready", matchId: this.id }); }
    if (this.ready[0] && this.ready[1]) this.fight(now);
  }

  /** A player's screen has finished showing the last battle; the deploy clock starts once both have. */
  markWatched(seat: Seat, round: number, now = Date.now()) {
    if (this.over || round !== this.match.round - 1) return;
    this.watched[seat] = true;
    this.startClock(now);
  }

  private startClock(now: number) {
    if (this.deadline !== null || this.over) return;
    if (!(this.watched[0] && this.watched[1]) && now < this.watchUntil) return;
    this.deadline = now + DEPLOY_SECS * 1000;
    for (const s of [0, 1] as Seat[]) {
      this.send(s, { t: "deploy", matchId: this.id, round: this.match.round, deadline: this.deadline, now });
    }
  }

  private fight(now: number) {
    const m = this.match;
    const round = m.round;
    const pieces: Piece[] = [...m.sides[0].pieces, ...m.sides[1].pieces].map((p) => ({ ...p }));
    const seed = m.battleSeed();
    const rep = m.fight();
    for (const s of [0, 1] as Seat[]) {
      this.idle[s] = this.acted[s] ? 0 : this.idle[s] + 1;
      this.logs[s].endRound();
    }
    let end: RoomEnd | null = null;
    if (m.phase === "over") end = this.finish(m.winner ?? -1, "hp");
    else {
      const out = ([0, 1] as Seat[]).filter((s) => this.idle[s] >= MAX_IDLE_ROUNDS);
      if (out.length) end = this.finish(out.length === 2 ? -1 : ((1 - out[0]) as Seat), "timeout");
    }
    if (!end) {
      m.next();
      this.snapGold();
      this.ready = [false, false];
      this.watched = [false, false];
      this.acted = [false, false];
      this.deadline = null;
      this.watchUntil = now + WATCH_MAX_SECS * 1000;
      // Timing is measured from here: a person watches the battle first, a script does not.
      for (const s of [0, 1] as Seat[]) this.logs[s].begin(now);
      this.botTurn();
    }
    for (const s of [0, 1] as Seat[]) {
      const battle: BattleMsg = {
        matchId: this.id, round, pieces, seed, ...(m.cfg.levels ? { levels: m.cfg.levels } : {}), winner: rep.winner, damage: rep.damage, hp: [m.sides[0].hp, m.sides[1].hp],
        over: !!end, matchWinner: end ? end.winner : null, next: end ? null : this.view(s, now),
      };
      this.send(s, { t: "battle", battle });
    }
    if (end) this.onEnd(this, end);
  }

  private finish(winner: -1 | Seat, reason: EndReason): RoomEnd {
    this.over = true;
    return { winner, reason, rounds: this.match.played, telemetry: [this.logs[0].summary(), this.logs[1].summary()] };
  }

  /** A player gives up (Quit, or gone too long). */
  forfeit(seat: Seat) {
    if (this.over) return;
    this.onEnd(this, this.finish((1 - seat) as Seat, "forfeit"));
  }

  /** Clock work: start the deploy clock when watching ran long; ready whoever ran out of time. */
  tick(now = Date.now()) {
    if (this.over) return;
    if (this.deadline === null) { this.startClock(now); return; }
    if (now < this.deadline + GRACE_MS) return;
    for (const s of [0, 1] as Seat[]) if (!this.ready[s] && !this.over) this.setReady(s, undefined, now, true);
  }
}
