// A match played online, as the game screen sees it. It is a Match the screen can drive as usual (buy, move, upgrade,
// sell), but the truth lives on the server: every purchase is sent as it is made, each shop comes from the server, the
// battle is the server's and so is its outcome. Locally the player is always side 0, at the bottom of the board; a
// seat-1 player's coordinates are turned on the way out and on the way in (src/net/mirror.ts).
import { Battle, type BattleResult } from "../core/battle";
import type { Piece, Side } from "../core/defs";
import { Match, type RoundReport } from "../core/match";
import { TurnedBattle, turnPiece, turnPoint } from "./mirror";
import { ID_BASE, type Action, type BattleMsg, type EndReason, type MatchReward, type Placement, type RatingChange, type RoundView, type Seat } from "./protocol";

/** How the match reaches the server (src/net/client.ts; a test passes its own). */
export interface NetLink {
  act(action: Action): Promise<{ ok: boolean; error?: string; view: RoundView }>;
  ready(placements: Placement[]): Promise<unknown>;
  watched(round: number): Promise<unknown>;
  forfeit(): Promise<unknown>;
}

export interface NetOver { winner: -1 | 0 | 1; reason: EndReason; rating?: RatingChange; reward?: MatchReward; }

export class NetMatch extends Match {
  readonly matchId: string;
  readonly seat: Seat;
  readonly ranked: boolean;
  /** The rival pressed Ready this round. */
  foeReady = false;
  /** Ready has been sent this round: the board is locked until the battle. */
  readySent = false;
  /** A reroll is on its way to the server: the shop is not ours to use until it answers. */
  busy = false;
  /** How the match ended (set when the server says so). */
  over: NetOver | null = null;
  /** The screen redraws its HUD (the server corrected something, the rival readied, the clock started). */
  onChange?: () => void;
  /** The match ended without a last battle to show (the rival quit or timed out). */
  onOver?: (o: NetOver) => void;
  private deadline: number | null = null;
  private battle: BattleMsg | null = null;
  private waitBattle: ((b: BattleMsg) => void) | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private inFlight = 0;

  constructor(view: RoundView, private link: NetLink) {
    super({
      seed: 1, names: [view.you.name, view.foe.name], idBase: [ID_BASE[view.seat], ID_BASE[1 - view.seat]],
      // Ranked: each side's server-held troop levels (ours first, as this screen sees the board).
      ...(view.levels ? { levels: [view.levels[view.seat], view.levels[1 - view.seat]] } : {}),
    });
    this.matchId = view.matchId;
    this.seat = view.seat;
    this.ranked = view.ranked;
    this.applyView(view);
  }

  /** A battle from the server is in hand (being replayed, or about to be). */
  get watching() { return !!this.battle; }

  // ------------------------------------------------------------ frames
  private local = (p: Piece): Piece => (this.seat === 0 ? { ...p } : turnPiece(p));
  private toServer(x: number, y: number) { return this.seat === 0 ? { x, y } : turnPoint(x, y); }
  private localWinner(w: -1 | Seat): -1 | 0 | 1 { return w < 0 ? -1 : w === this.seat ? 0 : 1; }

  /** Takes the server's view of the round as the truth. Pieces the player has dragged since keep where they were put. */
  applyView(v: RoundView, keepPlaces = false) {
    const you = this.sides[0], foe = this.sides[1];
    const at = new Map(keepPlaces ? you.pieces.map((p) => [p.id, p] as const) : []);
    this.round = v.round;
    this.phase = "deploy";
    you.name = v.you.name; you.hp = v.you.hp; you.maxHp = v.you.maxHp; you.gold = v.you.gold;
    you.shop = [...v.you.shop]; you.rerolls = v.you.rerolls; you.lastIncome = { ...v.you.lastIncome };
    you.pieces = v.you.pieces.map(this.local).map((p) => { const was = at.get(p.id); return was ? { ...p, x: was.x, y: was.y } : p; });
    you.seen = you.pieces.map((p) => ({ ...p }));
    this.setNextId(0, v.you.nextId);
    foe.name = v.foe.name; foe.hp = v.foe.hp; foe.maxHp = v.foe.maxHp; foe.gold = v.foe.gold;
    foe.seen = v.foe.seen.map(this.local);
    foe.pieces = foe.seen.map((p) => ({ ...p }));
    this.foeReady = v.foe.ready;
    this.readySent = v.ready;
    this.setDeadline(v.deadline, v.now);
  }
  /** Server clock to this device's clock. */
  setDeadline(deadline: number | null, serverNow: number) {
    this.deadline = deadline === null ? null : Date.now() + (deadline - serverNow);
  }
  /** Seconds left to deploy, or null while the clock has not started. */
  secondsLeft(): number | null {
    return this.deadline === null ? null : Math.max(0, (this.deadline - Date.now()) / 1000);
  }

  // ------------------------------------------------------------ actions: applied here at once, then sent in order
  private signature() {
    const s = this.sides[0];
    return `${s.gold}|${s.shop.join(",")}|${s.pieces.map((p) => `${p.id}:${p.kind}:${p.rank}`).sort().join(",")}`;
  }
  private static viewSignature(v: RoundView) {
    return `${v.you.gold}|${v.you.shop.join(",")}|${v.you.pieces.map((p) => `${p.id}:${p.kind}:${p.rank}`).sort().join(",")}`;
  }
  private send(a: Action) {
    this.inFlight++;
    const job = this.chain.then(() => this.link.act(a)).then((r) => {
      this.inFlight--;
      // Once nothing else is on its way, what the server holds must be what we show; if not, the server wins.
      if (this.inFlight === 0 && !this.readySent && r.view.matchId === this.matchId && r.view.round === this.round
        && (!r.ok || NetMatch.viewSignature(r.view) !== this.signature())) {
        this.applyView(r.view, true);
        this.onChange?.();
      }
      return r;
    }, (e) => { this.inFlight--; throw e; });
    this.chain = job.catch(() => undefined);
    return job;
  }

  override canBuy(s: Side, slot: number): string | null {
    if (s === 0 && (this.busy || this.readySent)) return "Wait";
    return super.canBuy(s, slot);
  }
  override canReroll(s: Side) { return !this.busy && !this.readySent && super.canReroll(s); }

  override buy(s: Side, slot: number, x: number, y: number): Piece {
    const p = super.buy(s, slot, x, y);
    if (s === 0) void this.send({ t: "buy", slot, ...this.toServer(x, y) }).catch(() => undefined);
    return p;
  }
  override upgrade(s: Side, id: number) {
    super.upgrade(s, id);
    if (s === 0) void this.send({ t: "upgrade", id }).catch(() => undefined);
  }
  override sell(s: Side, id: number) {
    super.sell(s, id);
    if (s === 0) void this.send({ t: "sell", id }).catch(() => undefined);
  }
  /** The reroll is the server's to make (its shop is the one that counts): ask, then show what it dealt. */
  async rerollNet(): Promise<boolean> {
    if (!this.canReroll(0)) return false;
    this.busy = true;
    try {
      const r = await this.send({ t: "reroll" });
      if (r.view.matchId === this.matchId && r.view.round === this.round) this.applyView(r.view, true);
      return r.ok;
    } catch { return false; } finally { this.busy = false; this.onChange?.(); }
  }
  override reroll() { throw Error("Online: use rerollNet()"); }

  /** Ready: sends where every piece stands, then waits for the server's battle. */
  async ready(): Promise<void> {
    const had = this.readySent;
    this.readySent = true;
    try {
      await this.chain;
      if (!had) await this.link.ready(this.sides[0].pieces.map((p) => ({ id: p.id, ...this.toServer(p.x, p.y) })));
    } catch (e) { this.readySent = had; throw e; }
    const b = this.battle ?? await new Promise<BattleMsg>((done) => { this.waitBattle = done; });
    // The boards as the server fought them (ours clamped by its rules, the rival's seen for the first time).
    this.sides[0].pieces = b.pieces.filter((p) => p.side === this.seat).map(this.local);
    this.sides[1].pieces = b.pieces.filter((p) => p.side !== this.seat).map(this.local);
  }

  // ------------------------------------------------------------ the server's pushes
  onFoeReady() { this.foeReady = true; this.onChange?.(); }
  onDeploy(round: number, deadline: number, serverNow: number) {
    const next = this.battle?.next;
    // Still watching the battle: the clock for the round after it has started; next() picks it up.
    if (next && round === next.round) { next.deadline = deadline; next.now = serverNow; this.clockAt = Date.now(); }
    else if (round === this.round && !this.battle) this.setDeadline(deadline, serverNow);
    this.onChange?.();
  }
  /** When a deploy push for the next round arrived (its deadline is on the server's clock as of then). */
  private clockAt = 0;
  onBattle(b: BattleMsg) {
    if (b.matchId !== this.matchId || b.round !== this.round) return;
    this.battle = b;
    this.readySent = true;
    this.waitBattle?.(b);
    this.waitBattle = null;
  }
  onMatchOver(winner: -1 | Seat, reason: EndReason, rating?: RatingChange, reward?: MatchReward) {
    this.over = { winner: this.localWinner(winner), reason, rating, reward };
    // A last battle in hand plays out first; the screen ends the match when it is done.
    if (this.battle?.over) return;
    this.phase = "over";
    this.winner = this.over.winner;
    this.onOver?.(this.over);
  }

  // ------------------------------------------------------------ the battle: the server's, replayed here
  override makeBattle(events = true): Battle {
    const b = this.battle;
    if (!b) throw Error("No battle from the server yet");
    this.phase = "battle";
    const real = new Battle(b.pieces.map((p) => ({ ...p })), { seed: b.seed, events, levels: b.levels });
    return this.seat === 0 ? real : new TurnedBattle(real).asBattle();
  }
  /** The outcome is the server's, whatever this device's replay came to. */
  override resolve(result: BattleResult): RoundReport {
    const b = this.battle;
    if (!b) throw Error("No battle from the server yet");
    const me = this.seat, them = (1 - me) as Seat;
    const rep: RoundReport = { round: b.round, winner: this.localWinner(b.winner), damage: [b.damage[me], b.damage[them]], result: { ...result, winner: this.localWinner(b.winner) } };
    this.sides[0].hp = b.hp[me];
    this.sides[1].hp = b.hp[them];
    this.history.push(rep);
    if (b.over) {
      this.phase = "over";
      this.winner = b.matchWinner === null ? -1 : this.localWinner(b.matchWinner);
    } else this.phase = "deploy";
    return rep;
  }
  /** The next round is whatever the server dealt. Also tells it this screen has finished with the battle. */
  override next() {
    const b = this.battle;
    if (!b?.next) return;
    this.battle = null;
    const v = b.next;
    // A deploy clock that started while the battle was still on screen has been running since.
    this.applyView(v);
    if (v.deadline !== null && this.clockAt) this.deadline = this.clockAt + (v.deadline - v.now);
    this.clockAt = 0;
    void this.link.watched(b.round).catch(() => undefined);
  }
  override startRound() {
    // The constructor's first round is replaced by the server's view straight away; later rounds come from next().
    if (this.round === 0) super.startRound();
  }

  forfeit() { return this.link.forfeit().catch(() => undefined); }
}
