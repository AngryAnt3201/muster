// Everything live on the server: who is connected, the matchmaking queue, friend challenges and the running matches.
// No transport in here (server/app.ts wires HTTP and WebSocket to it), so tests drive it directly.
import { randomBytes } from "node:crypto";
import { DEFAULT_AI, TACTICS, type AIProfile } from "../src/core/ai";
import { uniformLevels, type Levels } from "../src/core/levels";
import { hashSeed } from "../src/core/rng";
import { SCRIPTED_CAP, leagueOf } from "../src/net/ladder";
import type { AccountView, Action, FriendsView, Me, MatchReward, Placement, PlayerCard, Push, RoundView, Seat } from "../src/net/protocol";
import * as Acct from "./account";
import { Room, type RoomEnd } from "./room";
import { card, cleanCode, cleanName, Store, type PlayerRow } from "./store";

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const bad = (msg: string, status = 400): never => { throw new HttpError(status, msg); };

export interface Conn { send(data: string): void; close?(): void; }
export interface HubOptions {
  /** Nobody signs themselves up: every player holds a token you issued (npm run token). */
  inviteOnly?: boolean;
  /** How many of the server's own players to keep on the lower leagues (0 = none). */
  houseBots?: number;
  /** How long a player in the lower leagues waits for a person before a house bot takes the match. */
  botWaitMs?: number;
  /** Randomness for reward rolls (tests pass their own). */
  rand?: () => number;
  /** Milliseconds a player in a match may be disconnected before they forfeit. */
  goneMs?: number;
}

interface Challenge { id: string; from: string; to: string; created: number; }
const CHALLENGE_MS = 60_000;
/** The server's own players (original names; they sit in the lower leagues and never leave them). */
const HOUSE_NAMES = ["Old Bram", "Tilly Fenn", "Corporal Ash", "Wren", "Dobbin", "Marrow", "Pip Sedge", "Hale", "Gant", "Sorrel", "Quill", "Brannoch", "Mott",
  "Yarrow", "Kestrel", "Thistle", "Ostler Jape", "Fenwick", "Brindle", "Sister Rue", "Captain Loam", "Tam Reed", "Hob", "Greave"];
/** How a house bot plays, by its trophies: clumsy at the bottom, a fair fight near the top of its range. */
const botAi = (p: PlayerRow): AIProfile => ({ ...DEFAULT_AI, difficulty: 0.15 + 0.45 * Math.min(1, p.rating / SCRIPTED_CAP), tactic: TACTICS[hashSeed(p.id) % TACTICS.length], rerolls: p.rating > 300 ? 1 : 0 });
const newId = () => randomBytes(9).toString("base64url");

export class Hub {
  readonly rooms = new Map<string, Room>();
  private roomOf = new Map<string, Room>();
  private conns = new Map<string, Set<Conn>>();
  private queue: { id: string; rating: number; since: number }[] = [];
  private challenges = new Map<string, Challenge>();
  private gone = new Map<string, number>();

  constructor(readonly store: Store, private opts: HubOptions = {}) {
    if (opts.houseBots) store.ensureHouseBots(HOUSE_NAMES.slice(0, opts.houseBots));
  }

  // ------------------------------------------------------------ connections
  push(playerId: string, msg: Push) {
    const set = this.conns.get(playerId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const c of set) { try { c.send(data); } catch { /* a dying socket */ } }
  }
  online(id: string) { return (this.conns.get(id)?.size ?? 0) > 0; }
  get onlineCount() { return this.conns.size; }

  connect(p: PlayerRow, conn: Conn) {
    const first = !this.online(p.id);
    if (!this.conns.has(p.id)) this.conns.set(p.id, new Set());
    this.conns.get(p.id)!.add(conn);
    this.gone.delete(p.id);
    conn.send(JSON.stringify({ t: "hello", me: this.me(p.id), queued: this.queue.some((q) => q.id === p.id), match: this.matchView(p.id) } satisfies Push));
    for (const c of this.challenges.values()) if (c.to === p.id) conn.send(JSON.stringify({ t: "challenge", id: c.id, from: this.card(c.from) } satisfies Push));
    if (first) this.presence(p.id);
  }
  disconnect(playerId: string, conn: Conn, now = Date.now()) {
    const set = this.conns.get(playerId);
    if (!set) return;
    set.delete(conn);
    if (set.size) return;
    this.conns.delete(playerId);
    this.leaveQueue(playerId);
    for (const c of [...this.challenges.values()]) if (c.from === playerId) this.dropChallenge(c, "cancelled");
    if (this.roomOf.has(playerId)) this.gone.set(playerId, now);
    this.presence(playerId);
  }
  private presence(id: string) {
    const msg: Push = { t: "presence", id, online: this.online(id), inMatch: this.roomOf.has(id) };
    for (const f of this.store.friendIds(id)) this.push(f, msg);
  }

  // ------------------------------------------------------------ players and friends
  private row(id: string) { return this.store.player(id) ?? bad("No such player", 404); }
  private card(id: string): PlayerCard { const p = this.row(id); return { ...card(p), online: this.online(id) || p.kind === "house", inMatch: this.roomOf.has(id) }; }
  me(id: string): Me { const p = this.row(id); return { ...this.card(id), code: p.code }; }

  /** A player signing themselves up (refused on an invite-only server). */
  register(rawName: unknown, client: unknown) {
    if (this.opts.inviteOnly) bad("This server is invite only. Paste the token you were given.", 403);
    return this.mint(rawName, client);
  }
  /** Issues a token for a person. `friendCode` makes them friends with that player from the start. */
  mint(rawName: unknown, client: unknown, friendCode?: unknown, bot = false) {
    const host = friendCode ? this.store.byCode(cleanCode(friendCode)) ?? bad("No player has that friend code", 404) : null;
    const made = this.create(rawName, client, bot);
    if (host) { this.store.requestFriend(host.id, made.me.id); this.store.acceptFriend(host.id, made.me.id); this.push(host.id, { t: "friends" }); }
    return made;
  }
  /** Switches a player's token off (by player id or friend code): out of the queue, out of any match, sockets closed. */
  revoke(idOrCode: unknown) {
    const p = this.store.player(String(idOrCode)) ?? this.store.byCode(cleanCode(idOrCode)) ?? bad("No such player", 404);
    this.store.revoke(p.id);
    this.leaveQueue(p.id);
    this.forfeit(p.id);
    for (const c of [...(this.conns.get(p.id) ?? [])]) c.close?.();
    return { id: p.id, name: p.name };
  }
  players() { return this.store.players().map((p) => ({ ...card(p), code: p.code, kind: p.kind, client: p.client, revoked: !!p.revoked, flags: p.flags, created: p.created, online: this.online(p.id) })); }
  private create(rawName: unknown, client: unknown, bot = false) {
    const name = cleanName(rawName) || "Commander";
    const { player, token } = this.store.register(name, cleanName(client).toLowerCase().replace(/[^a-z0-9-]/g, "") || "web", bot ? "bot" : "human");
    return { token, me: this.me(player.id) };
  }
  rename(id: string, rawName: unknown) {
    const name = cleanName(rawName);
    if (name.length < 2) bad("Pick a name of at least two characters");
    this.store.rename(id, name);
    return this.me(id);
  }

  friends(id: string): FriendsView {
    const cards = (ids: string[]) => ids.map((x) => this.card(x));
    return {
      friends: cards(this.store.friendIds(id)).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
      incoming: cards(this.store.incomingIds(id)),
      outgoing: cards(this.store.outgoingIds(id)),
      challenges: [...this.challenges.values()].filter((c) => c.to === id).map((c) => ({ id: c.id, from: this.card(c.from) })),
    };
  }
  addFriend(id: string, rawCode: unknown) {
    const other = this.store.byCode(cleanCode(rawCode)) ?? bad("No player has that code", 404);
    if (other.id === id) bad("That is your own code");
    if (this.store.incomingIds(other.id).length >= 50) bad("They have too many requests waiting", 429);
    const state = this.store.requestFriend(id, other.id);
    this.push(other.id, { t: "friends" });
    this.push(id, { t: "friends" });
    return { state, player: this.card(other.id) };
  }
  respondFriend(id: string, otherId: unknown, accept: unknown) {
    const other = String(otherId);
    const ok = accept ? this.store.acceptFriend(other, id) : this.store.removeFriend(other, id);
    if (!ok) bad("No such request", 404);
    this.push(other, { t: "friends" });
    this.push(id, { t: "friends" });
    return this.friends(id);
  }
  removeFriend(id: string, otherId: unknown) {
    this.store.removeFriend(id, String(otherId));
    this.push(String(otherId), { t: "friends" });
    return this.friends(id);
  }

  // ------------------------------------------------------------ matchmaking
  private free(id: string) {
    if (this.roomOf.has(id)) bad("You are already in a match", 409);
  }
  joinQueue(id: string, now = Date.now()) {
    this.free(id);
    const p = this.row(id);
    if (!this.queue.some((q) => q.id === id)) this.queue.push({ id, rating: p.rating, since: now });
    this.push(id, { t: "queue", searching: true });
    this.pair(now);
    return { searching: this.queue.some((q) => q.id === id) };
  }
  leaveQueue(id: string) {
    const had = this.queue.length;
    this.queue = this.queue.filter((q) => q.id !== id);
    if (had !== this.queue.length) this.push(id, { t: "queue", searching: false });
    return { searching: false };
  }
  /** Pairs the longest waiters first; the rating gap a player accepts widens the longer they wait. */
  private pair(now: number) {
    const reach = (q: { since: number }) => 100 + 30 * ((now - q.since) / 1000);
    for (let i = 0; i < this.queue.length; i++) {
      const a = this.queue[i];
      const j = this.queue.findIndex((b, k) => k > i && Math.abs(b.rating - a.rating) <= Math.max(reach(a), reach(b)));
      if (j < 0) continue;
      const b = this.queue[j];
      this.queue.splice(j, 1); this.queue.splice(i, 1); i--;
      this.startMatch(a.id, b.id, true, now);
    }
    // The lower leagues always have someone to play: a player there who has waited long enough meets a house bot.
    for (const q of [...this.queue]) {
      if (q.rating > SCRIPTED_CAP || now - q.since < (this.opts.botWaitMs ?? 6000)) continue;
      const bot = this.store.houseBots().filter((b) => !this.roomOf.has(b.id)).sort((x, y) => Math.abs(x.rating - q.rating) - Math.abs(y.rating - q.rating))[0];
      if (!bot) continue;
      this.queue = this.queue.filter((x) => x !== q);
      this.startMatch(q.id, bot.id, true, now);
    }
  }
  /** The troop levels a player brings to a ranked match: their server-held ones (a house bot's follow its trophies). */
  private levelsOf(p: PlayerRow): Levels | undefined {
    if (p.kind === "house") return uniformLevels(1 + Math.floor(p.rating / 250));
    const l = this.store.account(p.id).levels;
    return Object.keys(l).length ? l : undefined;
  }

  challenge(id: string, friendId: unknown, now = Date.now()) {
    const to = String(friendId);
    this.free(id);
    if (!this.store.areFriends(id, to)) bad("You can only challenge a friend", 403);
    if (!this.online(to)) bad("They are offline", 409);
    if (this.roomOf.has(to)) bad("They are in a match", 409);
    for (const c of [...this.challenges.values()]) if (c.from === id) this.dropChallenge(c, "cancelled");
    // Two friends challenging each other at once is a yes from both.
    const back = [...this.challenges.values()].find((c) => c.from === to && c.to === id);
    if (back) return { id: back.id, matched: !!this.respondChallenge(id, back.id, true, now) };
    const c: Challenge = { id: newId(), from: id, to, created: now };
    this.challenges.set(c.id, c);
    this.push(to, { t: "challenge", id: c.id, from: this.card(id) });
    return { id: c.id, matched: false };
  }
  respondChallenge(id: string, challengeId: unknown, accept: unknown, now = Date.now()) {
    const c = this.challenges.get(String(challengeId));
    if (!c || c.to !== id) return bad("That challenge is gone", 404);
    if (!accept) { this.dropChallenge(c, "declined"); return null; }
    this.free(id);
    if (this.roomOf.has(c.from) || !this.online(c.from)) { this.dropChallenge(c, "cancelled"); return bad("They are no longer waiting", 409); }
    this.challenges.delete(c.id);
    this.leaveQueue(c.from); this.leaveQueue(id);
    return this.startMatch(c.from, id, false, now).view(1, now);
  }
  cancelChallenge(id: string, challengeId: unknown) {
    const c = this.challenges.get(String(challengeId));
    if (c && c.from === id) this.dropChallenge(c, "cancelled");
    return {};
  }
  private dropChallenge(c: Challenge, why: "declined" | "cancelled" | "expired") {
    this.challenges.delete(c.id);
    this.push(c.from, { t: "challenge_gone", id: c.id, why });
    this.push(c.to, { t: "challenge_gone", id: c.id, why });
  }

  // ------------------------------------------------------------ matches
  private startMatch(a: string, b: string, ranked: boolean, now: number) {
    const pa = this.row(a), pb = this.row(b);
    const levels: [Levels | undefined, Levels | undefined] | undefined = ranked ? [this.levelsOf(pa), this.levelsOf(pb)] : undefined;
    const bot = pb.kind === "house" ? { seat: 1 as Seat, ai: botAi(pb) } : pa.kind === "house" ? { seat: 0 as Seat, ai: botAi(pa) } : undefined;
    const room: Room = new Room(newId(), [{ id: a, name: pa.name }, { id: b, name: pb.name }], ranked,
      (seat, msg) => this.push(room.players[seat].id, msg), (r, end) => this.endMatch(r, end), now,
      { ...(levels?.[0] || levels?.[1] ? { levels } : {}), ...(bot ? { bot } : {}) });
    this.rooms.set(room.id, room);
    this.roomOf.set(a, room); this.roomOf.set(b, room);
    for (const s of [0, 1] as Seat[]) this.push(room.players[s].id, { t: "match_found", view: room.view(s, now) });
    this.presence(a); this.presence(b);
    return room;
  }
  private endMatch(room: Room, end: RoomEnd, now = Date.now()) {
    const [a, b] = room.players;
    // A ranked match pays into each person's server account, rolled here (house bots keep no account).
    const rewards: (MatchReward | undefined)[] = [undefined, undefined];
    if (room.ranked) for (const s of [0, 1] as Seat[]) {
      const p = this.row(room.players[s].id);
      if (p.kind === "house") continue;
      const acct = this.store.account(p.id);
      rewards[s] = Acct.matchReward(acct, { won: end.winner === s, league: leagueOf(p.rating).id, day: new Date(now).toISOString().slice(0, 10), rand: this.opts.rand ?? Math.random });
      this.store.saveAccount(p.id, acct);
    }
    const ratings = this.store.finishMatch({
      id: room.id, a: a.id, b: b.id, winner: end.winner, reason: end.reason, rounds: end.rounds, ranked: room.ranked ? 1 : 0,
      started: room.started, ended: now, telemetry: end.telemetry, flagged: [end.telemetry[0].flags.length > 0, end.telemetry[1].flags.length > 0],
    });
    this.rooms.delete(room.id);
    this.roomOf.delete(a.id); this.roomOf.delete(b.id);
    this.gone.delete(a.id); this.gone.delete(b.id);
    for (const s of [0, 1] as Seat[]) {
      this.push(room.players[s].id, { t: "match_over", matchId: room.id, winner: end.winner, reason: end.reason, ...(room.ranked ? { rating: ratings[s] } : {}), ...(rewards[s] ? { reward: rewards[s] } : {}) });
    }
    this.presence(a.id); this.presence(b.id);
  }

  private seat(id: string): { room: Room; seat: Seat } {
    const room = this.roomOf.get(id) ?? bad("You are not in a match", 409);
    return { room, seat: room.seatOf(id) as Seat };
  }
  matchView(id: string): RoundView | null {
    const room = this.roomOf.get(id);
    return room ? room.view(room.seatOf(id) as Seat) : null;
  }
  /** Applies a deploy action. Either way the caller gets the server's view back, so a client that guessed wrong resyncs. */
  act(id: string, action: Action): { ok: boolean; error?: string; view: RoundView } {
    const { room, seat } = this.seat(id);
    try { room.act(seat, action); } catch (e) { return { ok: false, error: (e as Error).message, view: room.view(seat) }; }
    return { ok: true, view: room.view(seat) };
  }
  ready(id: string, placements: Placement[] | undefined) {
    const { room, seat } = this.seat(id);
    room.setReady(seat, placements);
    return {};
  }
  watched(id: string, round: unknown) {
    const room = this.roomOf.get(id);
    if (room) room.markWatched(room.seatOf(id) as Seat, Number(round));
    return {};
  }
  forfeit(id: string) {
    const room = this.roomOf.get(id);
    if (room) room.forfeit(room.seatOf(id) as Seat);
    return {};
  }

  leaderboard() { return this.store.leaderboard().map(card); }

  // ------------------------------------------------------------ the economy (server/account.ts): the server's word is final
  private change<T>(id: string, fn: (a: Acct.Account) => T): { result: T; account: AccountView } {
    try {
      return this.store.atomic(() => {
        const a = this.store.account(id);
        const result = fn(a);
        this.store.saveAccount(id, a);
        return { result, account: Acct.view(a) };
      });
    } catch (e) { if (e instanceof Acct.AccountError) return bad(e.message); throw e; }
  }
  account(id: string): AccountView { return Acct.view(this.store.account(id)); }
  upgrade(id: string, kind: unknown) { return this.change(id, (a) => Acct.upgrade(a, kind)).account; }
  catalog() { return { products: Acct.PRODUCTS }; }
  buyWithGems(id: string, sku: unknown) { return this.change(id, (a) => Acct.buyWithGems(a, sku)).account; }
  /** A verified payment: credits the product once per transaction id, however often the provider repeats itself. */
  creditPayment(txId: unknown, player: unknown, sku: unknown, source: string) {
    const tx = String(txId ?? "");
    if (tx.length < 6 || tx.length > 200) bad("Bad transaction id");
    const p = this.store.player(String(player)) ?? this.store.byCode(cleanCode(player)) ?? bad("No such player", 404);
    try {
      return this.store.atomic(() => {
        if (!this.store.recordPurchase(tx, p.id, String(sku), source)) return { credited: false, player: p.id };
        const a = this.store.account(p.id);
        Acct.creditPaid(a, sku);
        this.store.saveAccount(p.id, a);
        return { credited: true, player: p.id };
      });
    } catch (e) { if (e instanceof Acct.AccountError) return bad(e.message); throw e; }
  }
  /** By hand, from the admin key: coins or gems for a player (a refund, a prize). Recorded like a purchase. */
  grant(player: unknown, coins: unknown, gems: unknown, note: unknown) {
    const p = this.store.player(String(player)) ?? this.store.byCode(cleanCode(player)) ?? bad("No such player", 404);
    const c = Math.max(0, Math.floor(Number(coins) || 0)), g = Math.max(0, Math.floor(Number(gems) || 0));
    if (!c && !g) bad("Nothing to grant");
    return this.store.atomic(() => {
      this.store.recordPurchase(`grant_${newId()}`, p.id, `grant:${c}c:${g}g:${cleanName(note)}`, "admin");
      const a = this.store.account(p.id);
      a.coins += c; a.gems += g;
      this.store.saveAccount(p.id, a);
      return { player: p.id, account: Acct.view(a) };
    });
  }
  /** A person wrongly counted as scripted: wipe their flags. */
  clearFlags(player: unknown) {
    const p = this.store.player(String(player)) ?? this.store.byCode(cleanCode(player)) ?? bad("No such player", 404);
    this.store.clearFlags(p.id);
    return { id: p.id, name: p.name };
  }
  history(id: string) {
    return this.store.history(id).map((m) => {
      const mine = m.a === id ? 0 : 1, other = this.store.player(mine === 0 ? m.b : m.a);
      return { id: m.id, foe: other?.name ?? "?", won: m.winner === mine, draw: m.winner < 0, reason: m.reason, rounds: m.rounds, ranked: !!m.ranked, ended: m.ended };
    });
  }
  /** Players whose matches tripped the automation checks, for a person to review. */
  flagged() {
    return this.store.flagged().map((p) => ({ ...card(p), flags: p.flags, client: p.client, recent: this.store.history(p.id, 5).map((m) => ({ id: m.id, telemetry: JSON.parse(m.telemetry) })) }));
  }

  /** Clock work, once a second: match clocks, players gone too long, stale challenges, widening the queue. */
  tick(now = Date.now()) {
    for (const room of [...this.rooms.values()]) room.tick(now);
    for (const [id, since] of [...this.gone]) if (now - since > (this.opts.goneMs ?? 45_000)) { this.gone.delete(id); this.forfeit(id); }
    for (const c of [...this.challenges.values()]) if (now - c.created > CHALLENGE_MS) this.dropChallenge(c, "expired");
    this.pair(now);
  }
}
