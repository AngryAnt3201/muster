// The match server's HTTP endpoints and WebSocket, over a Hub. Also serves the built game (dist/) when it is there,
// so one port (and one tunnel or one host) carries the game, the API and the socket.
import { timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { Hub, HttpError, type HubOptions } from "./hub";
import { Store, type PlayerRow } from "./store";
import { paidCheckout, verifyEvent } from "./stripe";

export interface AppOptions extends HubOptions {
  db?: string;
  /** Folder of the built game to serve (dist). */
  staticDir?: string;
  /** Requests a second one address may make (burst of three times that). 0 = no limit. */
  ratePerSec?: number;
  /** New accounts one address may make an hour. 0 = no limit. */
  registerPerHour?: number;
  /** Shared secret for /v1/admin (unset = admin routes are off). */
  adminKey?: string;
  /** Stripe's signing secret for the webhook at /v1/stripe/webhook (unset = the webhook is off). */
  stripeWebhookSecret?: string;
  /** Read the caller's address from X-Forwarded-For (only behind a proxy you run). */
  trustProxy?: boolean;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png",
  ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".ico": "image/x-icon",
};

/** A token bucket per key. */
class Limiter {
  private buckets = new Map<string, { n: number; at: number }>();
  constructor(private perSec: number, private burst: number) {}
  take(key: string, now = Date.now()) {
    if (!this.perSec) return true;
    const b = this.buckets.get(key) ?? { n: this.burst, at: now };
    b.n = Math.min(this.burst, b.n + ((now - b.at) / 1000) * this.perSec);
    b.at = now;
    this.buckets.set(key, b);
    if (b.n < 1) return false;
    b.n -= 1;
    return true;
  }
  sweep(now = Date.now()) { for (const [k, b] of this.buckets) if (now - b.at > 3_600_000) this.buckets.delete(k); }
}

export interface App { server: Server; hub: Hub; store: Store; close(): Promise<void>; }

export function createApp(opts: AppOptions = {}): App {
  const store = new Store(opts.db);
  const hub = new Hub(store, opts);
  const rate = opts.ratePerSec ?? 20;
  const requests = new Limiter(rate, rate * 3);
  const signups = new Limiter((opts.registerPerHour ?? 20) / 3600, opts.registerPerHour ?? 20);
  const staticDir = opts.staticDir && existsSync(opts.staticDir) ? resolve(opts.staticDir) : null;

  const ip = (req: IncomingMessage) =>
    (opts.trustProxy && String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
  const auth = (req: IncomingMessage): PlayerRow => {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""));
    const p = m && store.byToken(m[1]);
    if (!p) throw new HttpError(401, "Sign in again");
    return p;
  };
  const raw = (req: IncomingMessage) => new Promise<string>((done, fail) => {
    let size = 0; const chunks: Buffer[] = [];
    // Past the cap the rest is ignored (the 413 goes out, then the connection is dropped).
    req.on("data", (c: Buffer) => { size += c.length; if (size > 32_768) fail(new HttpError(413, "Too much")); else chunks.push(c); });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", fail);
  });
  const parse = (text: string): Record<string, unknown> => {
    if (!text) return {};
    try { const v = JSON.parse(text); return v && typeof v === "object" ? v : {}; } catch { throw new HttpError(400, "Bad JSON"); }
  };
  const body = async (req: IncomingMessage) => parse(await raw(req));
  const same = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

  type Handler = (ctx: { req: IncomingMessage; me: PlayerRow; body: Record<string, unknown> }) => unknown;
  /** Signed-in routes. Everything a player can do is here; the socket only carries the server's pushes. */
  const routes: Record<string, Handler> = {
    "GET /v1/me": ({ me }) => hub.me(me.id),
    "POST /v1/me": ({ me, body }) => hub.rename(me.id, body.name),
    "GET /v1/friends": ({ me }) => hub.friends(me.id),
    "POST /v1/friends/add": ({ me, body }) => hub.addFriend(me.id, body.code),
    "POST /v1/friends/respond": ({ me, body }) => hub.respondFriend(me.id, body.id, body.accept),
    "POST /v1/friends/remove": ({ me, body }) => hub.removeFriend(me.id, body.id),
    "POST /v1/queue/join": ({ me }) => hub.joinQueue(me.id),
    "POST /v1/queue/leave": ({ me }) => hub.leaveQueue(me.id),
    "POST /v1/challenge": ({ me, body }) => hub.challenge(me.id, body.friendId),
    "POST /v1/challenge/respond": ({ me, body }) => ({ view: hub.respondChallenge(me.id, body.id, body.accept) }),
    "POST /v1/challenge/cancel": ({ me, body }) => hub.cancelChallenge(me.id, body.id),
    "GET /v1/match": ({ me }) => ({ view: hub.matchView(me.id) }),
    "POST /v1/match/act": ({ me, body }) => hub.act(me.id, body.action as never),
    "POST /v1/match/ready": ({ me, body }) => hub.ready(me.id, body.placements as never),
    "POST /v1/match/watched": ({ me, body }) => hub.watched(me.id, body.round),
    "POST /v1/match/forfeit": ({ me }) => hub.forfeit(me.id),
    "GET /v1/history": ({ me }) => ({ matches: hub.history(me.id) }),
    // The economy: the server's account is the only one that counts.
    "GET /v1/account": ({ me }) => hub.account(me.id),
    "POST /v1/account/upgrade": ({ me, body }) => hub.upgrade(me.id, body.kind),
    "GET /v1/solo": ({ me, req }) => hub.solo(me.id, Number(new URL(req.url ?? "/", "http://x").searchParams.get("tz") ?? NaN)),
    "POST /v1/solo/ops": ({ me, body }) => hub.soloOps(me.id, body.ops, body.tz),
    "GET /v1/store": () => hub.catalog(),
    "POST /v1/store/checkout": ({ me, body, req }) => hub.checkout(me.id, body.product, body.offer, String(req.headers.origin ?? "")),
  };

  const json = (res: ServerResponse, status: number, data: unknown) => {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(data));
  };

  const serveStatic = (path: string, res: ServerResponse) => {
    if (!staticDir) return false;
    let file = resolve(join(staticDir, normalize(decodeURIComponent(path))));
    if (!file.startsWith(staticDir)) return false;
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(staticDir, "index.html");
    if (!existsSync(file)) return false;
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
    createReadStream(file).pipe(res);
    return true;
  };

  const server = createServer(async (req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "authorization, content-type");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); return void res.end(); }
    const path = (req.url ?? "/").split("?")[0];
    try {
      if (path === "/health") return json(res, 200, { ok: true, players: hub.onlineCount, matches: hub.rooms.size, inviteOnly: !!opts.inviteOnly });
      if (!path.startsWith("/v1/")) {
        if (req.method === "GET" && serveStatic(path, res)) return;
        throw new HttpError(404, "Not found");
      }
      if (!requests.take(ip(req))) throw new HttpError(429, "Slow down");
      const key = `${req.method} ${path}`;
      if (key === "POST /v1/register") {
        if (!signups.take(ip(req))) throw new HttpError(429, "Too many new accounts from here. Try again later.");
        const b = await body(req);
        return json(res, 200, hub.register(b.name, b.client));
      }
      if (key === "POST /v1/stripe/webhook") {
        // Money in. Stripe calls this when a checkout is paid; the signature over the exact body proves it is Stripe.
        if (!opts.stripeWebhookSecret) throw new HttpError(404, "Not found");
        const text = await raw(req);
        let event: unknown;
        try { event = verifyEvent(text, String(req.headers["stripe-signature"] ?? ""), opts.stripeWebhookSecret); } catch { throw new HttpError(401, "Bad signature"); }
        const paid = paidCheckout(event);
        return json(res, 200, paid ? hub.stripePaid(paid) : { ignored: true });
      }
      if (key === "GET /v1/leaderboard") return json(res, 200, { players: hub.leaderboard() });
      if (path.startsWith("/v1/admin/")) {
        // Yours only: issue and revoke tokens, list players, see who tripped the automation checks.
        if (!opts.adminKey || !same(String(req.headers["x-admin-key"] ?? ""), opts.adminKey)) throw new HttpError(404, "Not found");
        if (key === "GET /v1/admin/flagged") return json(res, 200, { players: hub.flagged() });
        if (key === "GET /v1/admin/players") return json(res, 200, { players: hub.players() });
        const b = req.method === "POST" ? await body(req) : {};
        if (key === "POST /v1/admin/tokens") return json(res, 200, hub.mint(b.name, b.client ?? "token", b.friend, !!b.bot));
        if (key === "POST /v1/admin/grant") return json(res, 200, hub.grant(b.player, b.coins, b.gems, b.note));
        if (key === "POST /v1/admin/clear-flags") return json(res, 200, hub.clearFlags(b.player));
        if (key === "POST /v1/admin/revoke") return json(res, 200, hub.revoke(b.player));
        throw new HttpError(404, "Not found");
      }
      const handler = routes[key];
      if (!handler) throw new HttpError(404, "Not found");
      const me = auth(req);
      const b = req.method === "POST" ? await body(req) : {};
      return json(res, 200, (await handler({ req, me, body: b })) ?? {});
    } catch (e) {
      if (e instanceof HttpError) {
        if (e.status === 413) { res.setHeader("connection", "close"); res.on("finish", () => req.destroy()); }
        return json(res, e.status, { error: e.message });
      }
      console.error(e);
      return json(res, 500, { error: "Something went wrong" });
    }
  });

  // The socket: the client's first message is {t:"auth", token}; after that the server only pushes.
  const wss = new WebSocketServer({ server, path: "/v1/ws", maxPayload: 4096 });
  wss.on("connection", (ws: WebSocket) => {
    let player: PlayerRow | undefined;
    const conn = { send: (data: string) => { if (ws.readyState === ws.OPEN) ws.send(data); }, close: () => ws.close(4403, "revoked") };
    const timer = setTimeout(() => { if (!player) ws.close(4401, "auth"); }, 5000);
    ws.on("message", (raw) => {
      if (player) return;
      try {
        const msg = JSON.parse(String(raw));
        const p = msg?.t === "auth" && typeof msg.token === "string" ? store.byToken(msg.token) : undefined;
        if (!p) return ws.close(4401, "auth");
        player = p;
        hub.connect(p, conn);
      } catch { ws.close(4400, "bad"); }
    });
    let alive = true;
    ws.on("pong", () => { alive = true; });
    const beat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 20_000);
    ws.on("close", () => { clearTimeout(timer); clearInterval(beat); if (player && !closed) hub.disconnect(player.id, conn); });
    ws.on("error", () => ws.terminate());
  });

  let closed = false;
  const clock = setInterval(() => { hub.tick(); requests.sweep(); signups.sweep(); }, 1000);
  return {
    server, hub, store,
    close: () => new Promise<void>((done) => {
      closed = true;
      clearInterval(clock);
      for (const c of wss.clients) c.terminate();
      wss.close();
      server.close(() => { store.close(); done(); });
      server.closeAllConnections?.();
    }),
  };
}
