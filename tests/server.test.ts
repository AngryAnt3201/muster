import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { UNITS, inZone } from "../src/core/defs";
import { simulate } from "../src/core/battle";
import { ID_BASE, type BattleMsg, type FriendsView, type Me, type Push, type RoundView } from "../src/net/protocol";
import { createApp, type App } from "../server/app";
import { Room } from "../server/room";
import { judge } from "../server/telemetry";

let app: App, base: string;
beforeAll(async () => {
  app = createApp({ ratePerSec: 0, registerPerHour: 0, adminKey: "k" });
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});
afterAll(() => app.close());

/** A player: an account, a socket and a list of everything the server pushed. */
class Client {
  token = ""; me!: Me; ws!: WebSocket; pushes: Push[] = [];
  private waiters: { test: (p: Push) => boolean; done: (p: Push) => void }[] = [];
  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw Object.assign(Error(data.error), { status: r.status });
    return data;
  }
  static async make(name: string) {
    const c = new Client();
    const r = await c.call("POST", "/v1/register", { name });
    c.token = r.token; c.me = r.me;
    c.ws = new WebSocket(base.replace("http", "ws") + "/v1/ws");
    c.ws.on("message", (raw) => {
      const p = JSON.parse(String(raw)) as Push;
      c.pushes.push(p);
      c.waiters = c.waiters.filter((w) => (w.test(p) ? (w.done(p), false) : true));
    });
    await new Promise((r) => c.ws.on("open", r));
    c.ws.send(JSON.stringify({ t: "auth", token: c.token }));
    await c.wait("hello");
    return c;
  }
  /** The next push of a kind (or one already received and not yet taken). */
  wait<K extends Push["t"]>(t: K, from = 0): Promise<Extract<Push, { t: K }>> {
    const had = this.pushes.slice(from).find((p) => p.t === t);
    if (had) return Promise.resolve(had as never);
    return new Promise((done) => this.waiters.push({ test: (p) => p.t === t, done: done as never }));
  }
}

/** Buys what it can afford, front to back, then readies. */
async function playRound(c: Client, v: RoundView) {
  let view = v;
  for (let slot = 0; slot < view.you.shop.length; slot++) {
    const k = view.you.shop[slot];
    if (!k || UNITS[k].cost > view.you.gold) continue;
    const r = await c.call("POST", "/v1/match/act", { action: { t: "buy", slot, x: 1.5 + slot * 2, y: view.seat === 0 ? 11 : 3 } });
    view = r.view;
  }
  await c.call("POST", "/v1/match/ready", { placements: view.you.pieces.map((p) => ({ id: p.id, x: p.x, y: p.y })) });
  return view;
}

describe("match server", () => {
  it("registers, renames and keeps the token secret", async () => {
    const a = await Client.make("  Ada <b> ");
    expect(a.me.name).toBe("Ada b");
    expect(a.me.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(a.me.rating).toBe(0);
    expect((await a.call("POST", "/v1/me", { name: "Countess" })).name).toBe("Countess");
    await expect(new Client().call("GET", "/v1/me")).rejects.toMatchObject({ status: 401 });
    const stored = app.store.db.prepare("SELECT token FROM players WHERE id = ?").get(a.me.id) as { token: string };
    expect(stored.token).not.toBe(a.token);
    a.ws.close();
  });

  it("friends: request by code, accept, presence, remove", async () => {
    const a = await Client.make("Ann"), b = await Client.make("Bob");
    await expect(a.call("POST", "/v1/friends/add", { code: a.me.code })).rejects.toThrow(/own code/);
    await expect(a.call("POST", "/v1/friends/add", { code: "ZZZZZZ" })).rejects.toMatchObject({ status: 404 });
    expect((await a.call("POST", "/v1/friends/add", { code: b.me.code.toLowerCase() })).state).toBe("sent");
    await b.wait("friends");
    let fb = await b.call<FriendsView>("GET", "/v1/friends");
    expect(fb.incoming.map((p) => p.name)).toEqual(["Ann"]);
    // Not friends yet: no challenge.
    await expect(a.call("POST", "/v1/challenge", { friendId: b.me.id })).rejects.toMatchObject({ status: 403 });
    fb = await b.call("POST", "/v1/friends/respond", { id: a.me.id, accept: true });
    expect(fb.friends.map((p) => [p.name, p.online])).toEqual([["Ann", true]]);
    const from = b.pushes.length;
    a.ws.close();
    const gone = await b.wait("presence", from);
    expect(gone).toMatchObject({ id: a.me.id, online: false });
    fb = await b.call("POST", "/v1/friends/remove", { id: a.me.id });
    expect(fb.friends).toEqual([]);
    b.ws.close();
  });

  it("plays a ranked match from the queue to the end, server-side, and moves the ratings", async () => {
    const a = await Client.make("Queue A"), b = await Client.make("Queue B");
    expect((await a.call("POST", "/v1/queue/join")).searching).toBe(true);
    await b.call("POST", "/v1/queue/join");
    const [fa, fb] = await Promise.all([a.wait("match_found"), b.wait("match_found")]);
    expect([fa.view.seat, fb.view.seat].sort()).toEqual([0, 1]);
    expect(fa.view.ranked).toBe(true);
    expect(fa.view.foe.name).toBe("Queue B");
    await expect(a.call("POST", "/v1/queue/join")).rejects.toMatchObject({ status: 409 });

    let va: RoundView | null = fa.view, vb: RoundView | null = fb.view, rounds = 0, last: BattleMsg | undefined;
    while (va && vb) {
      const from = a.pushes.length, fromB = b.pushes.length;
      // What a player is told about the rival is only the board as the round began.
      expect(va.foe.seen.length).toBe(vb.you.pieces.length);
      expect(JSON.stringify(va)).not.toContain('"seed"');
      await Promise.all([playRound(a, va), playRound(b, vb)]);
      const [ba, bb] = await Promise.all([a.wait("battle", from), b.wait("battle", fromB)]);
      last = ba.battle;
      rounds++;
      expect(bb.battle.pieces).toEqual(ba.battle.pieces);
      // Per-seat ids, every piece inside its own half.
      for (const p of last.pieces) {
        expect(p.id >= ID_BASE[1] ? 1 : 0).toBe(p.side);
        expect(inZone(p.side, p.x, p.y)).toBe(true);
      }
      // The battle a client replays from the pieces and seed is the one the server fought.
      const replay = simulate(last.pieces.map((p) => ({ ...p })), { seed: last.seed });
      expect(replay.winner).toBe(last.winner);
      va = ba.battle.next; vb = bb.battle.next;
      if (va) expect(va.deadline).toBeNull();
    }
    expect(last!.over).toBe(true);
    expect(rounds).toBeGreaterThan(3);
    const [oa, ob] = await Promise.all([a.wait("match_over"), b.wait("match_over")]);
    expect(oa.winner).toBe(last!.matchWinner);
    expect(oa.reason).toBe("hp");
    const winner = oa.winner === fa.view.seat ? oa : ob, loser = winner === oa ? ob : oa;
    // Trophies: the winner climbs; a loss at the very bottom has nowhere to fall.
    expect(winner.rating).toEqual({ before: 0, after: 30 });
    expect(loser.rating).toEqual({ before: 0, after: 0 });
    // Ranked play pays into the server-held account: the winner gets coins and cards, the loser a few coins.
    expect(winner.reward!.coins).toBe(40);
    expect(winner.reward!.cards).toHaveLength(2);
    expect(loser.reward).toEqual({ coins: 8, cards: [] });
    expect((await a.call("GET", "/v1/match")).view).toBeNull();
    const hist = (await a.call("GET", "/v1/history")).matches;
    expect(hist[0]).toMatchObject({ foe: "Queue B", ranked: true, rounds });
    expect((await a.call("GET", "/v1/leaderboard")).players.length).toBeGreaterThanOrEqual(2);
    // Scripted players ready the instant a round opens: the automation checks flag both.
    const flagged = (await (await fetch(base + "/v1/admin/flagged", { headers: { "x-admin-key": "k" } })).json()).players;
    expect(flagged.map((p: { id: string }) => p.id)).toEqual(expect.arrayContaining([a.me.id, b.me.id]));
    expect((await fetch(base + "/v1/admin/flagged")).status).toBe(404);
    a.ws.close(); b.ws.close();
  }, 120_000);

  it("friend challenge: accept starts an unranked match; illegal actions are refused; quitting forfeits", async () => {
    const a = await Client.make("Cara"), b = await Client.make("Dev");
    await a.call("POST", "/v1/friends/add", { code: b.me.code });
    await b.call("POST", "/v1/friends/add", { code: a.me.code }); // asking back is a yes
    expect((await a.call<FriendsView>("GET", "/v1/friends")).friends).toHaveLength(1);
    const { id } = await a.call("POST", "/v1/challenge", { friendId: b.me.id });
    const ch = await b.wait("challenge");
    expect(ch).toMatchObject({ id, from: { name: "Cara" } });
    const { view } = await b.call("POST", "/v1/challenge/respond", { id, accept: true });
    const found = await a.wait("match_found");
    expect(view.ranked).toBe(false);
    expect(found.view.seat).toBe(0);
    expect(view.seat).toBe(1);

    // Rules are the server's: no buying with gold you lack, from an empty slot, a piece that is not yours.
    const gold = found.view.you.gold;
    const slot = found.view.you.shop.findIndex((k) => k && UNITS[k].cost <= gold);
    const ok = await a.call("POST", "/v1/match/act", { action: { t: "buy", slot, x: 4.5, y: 1 } }); // asked for the rival's half
    expect(ok.ok).toBe(true);
    expect(inZone(0, ok.view.you.pieces[0].x, ok.view.you.pieces[0].y)).toBe(true);
    const again = await a.call("POST", "/v1/match/act", { action: { t: "buy", slot, x: 4.5, y: 12 } });
    expect(again).toMatchObject({ ok: false, error: "Sold" });
    expect(again.view.you.gold).toBe(ok.view.you.gold);
    const theirs = await b.call("POST", "/v1/match/act", { action: { t: "sell", id: ok.view.you.pieces[0].id } });
    expect(theirs.ok).toBe(false);
    expect((await a.call("POST", "/v1/match/act", { action: { t: "upgrade", id: 999 } })).ok).toBe(false);
    expect((await a.call("POST", "/v1/match/act", { action: { t: "nope" } })).ok).toBe(false);
    // The rival cannot see this round's purchase.
    expect((await b.call("GET", "/v1/match")).view.foe.seen).toEqual([]);
    expect((await b.call("GET", "/v1/match")).view.foe.gold).toBe(gold);

    await b.call("POST", "/v1/match/forfeit");
    const over = await a.wait("match_over");
    expect(over).toMatchObject({ winner: 0, reason: "forfeit" });
    expect(over.rating).toBeUndefined();
    expect(over.reward).toBeUndefined();
    expect((await a.call<Me>("GET", "/v1/me")).rating).toBe(0);
    a.ws.close(); b.ws.close();
  });

  it("refuses unauthenticated sockets and oversized bodies", async () => {
    const ws = new WebSocket(base.replace("http", "ws") + "/v1/ws");
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "auth", token: "nope" }));
    const code = await new Promise((r) => ws.on("close", r));
    expect(code).toBe(4401);
    const r = await fetch(base + "/v1/register", { method: "POST", body: JSON.stringify({ name: "x".repeat(40_000) }) });
    expect(r.status).toBe(413);
  });
});

describe("invite-only server", () => {
  it("only issued tokens get in; a revoked one is out at once", async () => {
    const closed = createApp({ ratePerSec: 0, registerPerHour: 0, adminKey: "secret", inviteOnly: true });
    await new Promise<void>((r) => closed.server.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(closed.server.address() as AddressInfo).port}`;
    const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
      const r = await fetch(url + path, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
      return { status: r.status, data: await r.json() };
    };
    const admin = { "x-admin-key": "secret" };
    expect((await call("POST", "/v1/register", { name: "Walk-in" })).status).toBe(403);
    expect((await call("POST", "/v1/admin/tokens", { name: "Sam" })).status).toBe(404);
    expect((await call("POST", "/v1/admin/tokens", { name: "Sam" }, { "x-admin-key": "secreT" })).status).toBe(404);
    const host = (await call("POST", "/v1/admin/tokens", { name: "Host" }, admin)).data;
    const sam = (await call("POST", "/v1/admin/tokens", { name: "Sam", friend: host.me.code }, admin)).data;
    expect(sam.token).toMatch(/^mst_/);
    const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
    // Issued as the host's friend: nothing to accept.
    expect((await call("GET", "/v1/friends", undefined, bearer(sam.token))).data.friends.map((p: { name: string }) => p.name)).toEqual(["Host"]);
    expect((await call("POST", "/v1/admin/tokens", { name: "X", friend: "ZZZZZZ" }, admin)).status).toBe(404);
    const listed = (await call("GET", "/v1/admin/players", undefined, admin)).data.players;
    expect(listed.map((p: { name: string }) => p.name).sort()).toEqual(["Host", "Sam"]);
    expect(JSON.stringify(listed)).not.toContain("mst_");

    const ws = new WebSocket(url.replace("http", "ws") + "/v1/ws");
    await new Promise((r) => ws.on("open", r));
    ws.send(JSON.stringify({ t: "auth", token: sam.token }));
    await new Promise((r) => ws.once("message", r));
    const dropped = new Promise((r) => ws.on("close", r));
    expect((await call("POST", "/v1/admin/revoke", { player: sam.me.code }, admin)).data.name).toBe("Sam");
    expect(await dropped).toBe(4403);
    expect((await call("GET", "/v1/me", undefined, bearer(sam.token))).status).toBe(401);
    expect((await call("GET", "/v1/me", undefined, bearer(host.token))).status).toBe(200);
    await closed.close();
  });
});

describe("room clocks", () => {
  const mk = (now: number) => {
    const sent: [number, Push][] = [];
    let end: unknown = null;
    const room = new Room("m", [{ id: "a", name: "A" }, { id: "b", name: "B" }], false, (s, m) => sent.push([s, m]), (_r, e) => { end = e; }, now);
    return { room, sent, end: () => end as { winner: number; reason: string } | null };
  };
  it("readies a player who runs out of time, and forfeits one who never plays", () => {
    let now = 1_000_000;
    const { room, sent, end } = mk(now);
    const deadline = room.view(0, now).deadline!;
    room.tick(deadline + 1000);
    expect(sent.filter(([, m]) => m.t === "battle")).toHaveLength(0); // inside the grace
    for (let r = 1; r <= 3 && !end(); r++) {
      // Seat 0 plays; seat 1 never does.
      const v = room.view(0, now);
      const slot = v.you.shop.findIndex((k) => k && UNITS[k].cost <= v.you.gold);
      if (slot >= 0) room.act(0, { t: "buy", slot, x: 4.5, y: 11 }, now);
      room.setReady(0, undefined, now);
      now = (room.view(0, now).deadline ?? now) + 3000;
      room.tick(now); // forces seat 1
      if (end()) break;
      expect(room.view(0, now).deadline).toBeNull(); // waiting for the battle to be watched
      room.markWatched(0, r, now); room.markWatched(1, r, now);
      expect(room.view(0, now).deadline).toBeGreaterThan(now);
    }
    expect(end()).toMatchObject({ winner: 0, reason: "timeout" });
    expect(sent.filter(([s, m]) => s === 0 && m.t === "battle")).toHaveLength(3);
  });
  it("starts the deploy clock anyway when a player never reports the battle watched", () => {
    const now = 5_000_000;
    const { room, sent } = mk(now);
    room.setReady(0, undefined, now); room.setReady(1, undefined, now);
    expect(room.view(0, now).deadline).toBeNull();
    room.tick(now + 30_000);
    expect(room.view(0, now).deadline).toBeNull();
    room.tick(now + 81_000);
    expect(room.view(0, now).deadline).toBe(now + 81_000 + 45_000);
    expect(sent.some(([, m]) => m.t === "deploy")).toBe(true);
  });
});

describe("automation checks", () => {
  const rounds = (n: number, readyAfter: number) => Array.from({ length: n }, () => ({ actions: 3, readyAfter }));
  it("passes uneven, human-paced play", () => {
    const gaps = [900, 1400, 620, 2300, 480, 1750, 800, 3100, 560, 1200, 950, 2100, 700];
    expect(judge(gaps, rounds(6, 14_000)).flags).toEqual([]);
  });
  it("flags clockwork gaps, impossible speed and instant rounds", () => {
    expect(judge(Array(14).fill(500), rounds(6, 9000)).flags).toEqual(["metronome"]);
    expect(judge([40, 90, 60, 120, 30, 80, 55, 110, 45, 70, 95, 35, 65], rounds(6, 9000)).flags).toEqual(["inhuman-speed"]);
    expect(judge([900, 2000, 700], rounds(4, 600)).flags).toEqual(["instant-rounds"]);
  });
});
