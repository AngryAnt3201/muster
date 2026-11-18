// Players, friendships and finished matches, in SQLite (Node's built-in driver: no native build step).
import { createHash, randomBytes, randomInt } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { SCRIPTED_CAP, SCRIPTED_FLAGS, applyTrophies, trophyChange } from "../src/net/ladder";
import { NAME_MAX, type PlayerCard } from "../src/net/protocol";
import { newRecord, type AccountRecord } from "./account";

// Loaded through process so bundlers and vite-node, which do not know this newer built-in, leave it alone.
const sqlite = (process as unknown as { getBuiltinModule(id: string): typeof import("node:sqlite") }).getBuiltinModule("node:sqlite");

/** kind: 'human', 'bot' (a token issued for a script) or 'house' (the server's own players). rating = trophies. */
export interface PlayerRow { id: string; name: string; code: string; kind: string; rating: number; peak: number; wins: number; losses: number; client: string; revoked: number; flags: number; created: number; }
export interface MatchRow { id: string; a: string; b: string; winner: number; reason: string; rounds: number; ranked: number; started: number; ended: number; telemetry: string; }

/** Friend codes: six characters, no look-alikes (0/O, 1/I/L). */
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join("");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");
export const cleanName = (raw: unknown) => String(raw ?? "").replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
export const cleanCode = (raw: unknown) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);

export class Store {
  readonly db: DatabaseSync;
  constructor(path = ":memory:") {
    this.db = new sqlite.DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS players (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, token TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'human', rating INTEGER NOT NULL DEFAULT 0, peak INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0,
        client TEXT NOT NULL DEFAULT 'web', revoked INTEGER NOT NULL DEFAULT 0, flags INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS friends (
        a TEXT NOT NULL, b TEXT NOT NULL, state TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (a, b));
      CREATE INDEX IF NOT EXISTS friends_b ON friends (b);
      CREATE TABLE IF NOT EXISTS matches (
        id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, winner INTEGER NOT NULL, reason TEXT NOT NULL, rounds INTEGER NOT NULL,
        ranked INTEGER NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL, telemetry TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS accounts (player TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS purchases (
        tx TEXT PRIMARY KEY, player TEXT NOT NULL, sku TEXT NOT NULL, source TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS matches_a ON matches (a, ended);
      CREATE INDEX IF NOT EXISTS matches_b ON matches (b, ended);
    `);
  }
  close() { this.db.close(); }

  private one<T>(sql: string, ...args: (string | number)[]) { return this.db.prepare(sql).get(...args) as T | undefined; }
  private all<T>(sql: string, ...args: (string | number)[]) { return this.db.prepare(sql).all(...args) as T[]; }
  private run(sql: string, ...args: (string | number)[]) { return this.db.prepare(sql).run(...args); }

  // ------------------------------------------------------------ players
  /** A new player. The token is returned once and only its hash is kept. */
  register(name: string, client: string, kind: "human" | "bot" = "human", now = Date.now()): { player: PlayerRow; token: string } {
    const id = randomBytes(9).toString("base64url");
    const token = `mst_${randomBytes(32).toString("base64url")}`;
    for (let i = 0; ; i++) {
      try {
        this.run("INSERT INTO players (id, name, code, token, client, kind, created) VALUES (?, ?, ?, ?, ?, ?, ?)", id, name, newCode(), hash(token), client, kind, now);
        break;
      } catch (e) { if (i > 8) throw e; /* a code clash: roll another */ }
    }
    return { player: this.player(id)!, token };
  }
  player(id: string) { return this.one<PlayerRow>("SELECT * FROM players WHERE id = ?", id); }
  byToken(token: string) { return this.one<PlayerRow>("SELECT * FROM players WHERE token = ? AND revoked = 0", hash(token)); }
  /** Switches a player's token off for good. */
  revoke(id: string) { return this.run("UPDATE players SET revoked = 1 WHERE id = ?", id).changes > 0; }
  players(limit = 500) { return this.all<PlayerRow>("SELECT * FROM players ORDER BY created DESC LIMIT ?", limit); }
  byCode(code: string) { return this.one<PlayerRow>("SELECT * FROM players WHERE code = ?", code); }
  rename(id: string, name: string) { this.run("UPDATE players SET name = ? WHERE id = ?", name, id); }
  leaderboard(limit = 50) { return this.all<PlayerRow>("SELECT * FROM players WHERE revoked = 0 AND (wins + losses > 0 OR kind = 'house') ORDER BY rating DESC, wins DESC LIMIT ?", limit); }
  clearFlags(id: string) { this.run("UPDATE players SET flags = 0 WHERE id = ?", id); }

  // ------------------------------------------------------------ house bots
  /** The server's own players, spread over the lower leagues so there is always someone to meet there. They hold no token. */
  ensureHouseBots(names: string[], now = Date.now()) {
    const have = new Set(this.houseBots().map((b) => b.name));
    names.forEach((name, i) => {
      if (have.has(name)) return;
      const trophies = Math.round((SCRIPTED_CAP * i) / Math.max(1, names.length - 1));
      this.run("INSERT INTO players (id, name, code, token, client, kind, rating, peak, created) VALUES (?, ?, ?, ?, 'server', 'house', ?, ?, ?)",
        randomBytes(9).toString("base64url"), name, newCode(), hash(randomBytes(32).toString("hex")), trophies, trophies, now);
    });
  }
  houseBots() { return this.all<PlayerRow>("SELECT * FROM players WHERE kind = 'house' ORDER BY rating"); }

  // ------------------------------------------------------------ accounts (the economy: server/account.ts)
  account(id: string): AccountRecord {
    const row = this.one<{ state: string }>("SELECT state FROM accounts WHERE player = ?", id);
    if (!row) return newRecord();
    const fresh = newRecord(), got = JSON.parse(row.state) as Partial<AccountRecord>;
    return { save: { ...fresh.save, ...got.save }, meta: { ...fresh.meta, ...got.meta } };
  }
  saveAccount(id: string, a: AccountRecord) { this.run("INSERT OR REPLACE INTO accounts (player, state) VALUES (?, ?)", id, JSON.stringify(a)); }
  /** A value the server keeps for itself (the dice secret). */
  secret(name: string, make: () => string) {
    this.db.exec("CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const row = this.one<{ value: string }>("SELECT value FROM secrets WHERE name = ?", name);
    if (row) return row.value;
    const value = make();
    this.run("INSERT INTO secrets (name, value) VALUES (?, ?)", name, value);
    return value;
  }
  /** Runs `fn` as one transaction: all of it lands or none of it. */
  atomic<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try { const r = fn(); this.db.exec("COMMIT"); return r; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
  }
  /** Notes a payment. False when that transaction was already recorded: it must not pay out twice. */
  recordPurchase(tx: string, player: string, sku: string, source: string, now = Date.now()) {
    return this.run("INSERT OR IGNORE INTO purchases (tx, player, sku, source, created) VALUES (?, ?, ?, ?, ?)", tx, player, sku, source, now).changes > 0;
  }
  purchases(player: string) { return this.all<{ tx: string; sku: string; source: string; created: number }>("SELECT tx, sku, source, created FROM purchases WHERE player = ? ORDER BY created DESC", player); }
  flagged(limit = 100) { return this.all<PlayerRow>("SELECT * FROM players WHERE flags > 0 ORDER BY flags DESC LIMIT ?", limit); }

  // ------------------------------------------------------------ friends
  /** Rows are directed while pending (a asked b) and stored once (a < b) when accepted. */
  areFriends(x: string, y: string) {
    const [a, b] = x < y ? [x, y] : [y, x];
    return !!this.one("SELECT 1 FROM friends WHERE a = ? AND b = ? AND state = 'friends'", a, b);
  }
  /** Asks `to` to be friends. If they had already asked, that is a yes from both. */
  requestFriend(from: string, to: string, now = Date.now()): "sent" | "friends" | "already" {
    if (this.areFriends(from, to)) return "already";
    if (this.one("SELECT 1 FROM friends WHERE a = ? AND b = ? AND state = 'pending'", to, from)) { this.acceptFriend(to, from, now); return "friends"; }
    if (this.one("SELECT 1 FROM friends WHERE a = ? AND b = ? AND state = 'pending'", from, to)) return "already";
    this.run("INSERT INTO friends (a, b, state, created) VALUES (?, ?, 'pending', ?)", from, to, now);
    return "sent";
  }
  /** `to` accepts the request `from` sent. */
  acceptFriend(from: string, to: string, now = Date.now()) {
    const had = this.run("DELETE FROM friends WHERE a = ? AND b = ? AND state = 'pending'", from, to).changes;
    if (!had) return false;
    const [a, b] = from < to ? [from, to] : [to, from];
    this.run("INSERT OR REPLACE INTO friends (a, b, state, created) VALUES (?, ?, 'friends', ?)", a, b, now);
    return true;
  }
  /** Drops a friendship or a request in either direction. */
  removeFriend(x: string, y: string) {
    return this.run("DELETE FROM friends WHERE (a = ? AND b = ?) OR (a = ? AND b = ?)", x, y, y, x).changes > 0;
  }
  friendIds(id: string) {
    return this.all<{ id: string }>("SELECT CASE WHEN a = ? THEN b ELSE a END AS id FROM friends WHERE state = 'friends' AND (a = ? OR b = ?)", id, id, id).map((r) => r.id);
  }
  incomingIds(id: string) { return this.all<{ a: string }>("SELECT a FROM friends WHERE b = ? AND state = 'pending' ORDER BY created", id).map((r) => r.a); }
  outgoingIds(id: string) { return this.all<{ b: string }>("SELECT b FROM friends WHERE a = ? AND state = 'pending' ORDER BY created", id).map((r) => r.b); }

  // ------------------------------------------------------------ matches
  /** Records a finished match; a ranked one moves both players' trophies (src/net/ladder.ts). Returns each seat's trophies before and after. */
  finishMatch(m: Omit<MatchRow, "telemetry"> & { telemetry: unknown; flagged: [boolean, boolean] }) {
    const pa = this.player(m.a)!, pb = this.player(m.b)!;
    let na = { trophies: pa.rating, peak: pa.peak }, nb = { trophies: pb.rating, peak: pb.peak };
    if (m.ranked && m.winner >= 0) {
      na = applyTrophies(pa.rating, pa.peak, trophyChange(pa.rating, pb.rating, m.winner === 0), scripted(pa));
      nb = applyTrophies(pb.rating, pb.peak, trophyChange(pb.rating, pa.rating, m.winner === 1), scripted(pb));
    }
    this.run("INSERT OR REPLACE INTO matches (id, a, b, winner, reason, rounds, ranked, started, ended, telemetry) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      m.id, m.a, m.b, m.winner, m.reason, m.rounds, m.ranked, m.started, m.ended, JSON.stringify(m.telemetry));
    const upd = (id: string, n: { trophies: number; peak: number }, won: boolean, lost: boolean, flag: boolean) =>
      this.run("UPDATE players SET rating = ?, peak = ?, wins = wins + ?, losses = losses + ?, flags = flags + ? WHERE id = ?", n.trophies, n.peak, won ? 1 : 0, lost ? 1 : 0, flag ? 1 : 0, id);
    upd(m.a, na, m.winner === 0, m.winner === 1, m.flagged[0]);
    upd(m.b, nb, m.winner === 1, m.winner === 0, m.flagged[1]);
    return [{ before: pa.rating, after: na.trophies }, { before: pb.rating, after: nb.trophies }] as const;
  }
  history(id: string, limit = 20) {
    return this.all<MatchRow>("SELECT * FROM matches WHERE a = ? OR b = ? ORDER BY ended DESC LIMIT ?", id, id, limit);
  }
}

/** Plays by script: a house bot, a bot token, or an account the automation checks have flagged SCRIPTED_FLAGS times. */
export const scripted = (p: PlayerRow) => p.kind !== "human" || p.flags >= SCRIPTED_FLAGS;
export const card = (p: PlayerRow): PlayerCard => ({ id: p.id, name: p.name, rating: p.rating, wins: p.wins, losses: p.losses, ...(scripted(p) ? { bot: true } : {}) });
