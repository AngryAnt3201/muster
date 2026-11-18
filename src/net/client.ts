// The game's line to the match server: an account on this device, the HTTP calls, and the socket the server pushes on.
import type { NetLink } from "./netmatch";
import type { AccountView, FriendsView, Me, PlayerCard, Product, Push, RoundView } from "./protocol";

const q = new URLSearchParams(typeof location === "undefined" ? "" : location.search);
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Where the match server is: ?server=, a saved choice, the build's VITE_MUSTER_SERVER, the dev server's neighbour on
 *  :8787, or the page's own origin when the match server is what served the game. Null in a build with none set. */
export function serverUrl(): string | null {
  const asked = q.get("server");
  if (asked) store.set("muster.server", asked);
  const fixed = asked || store.get("muster.server") || (import.meta.env?.VITE_MUSTER_SERVER as string | undefined);
  if (fixed) return fixed.replace(/\/+$/, "");
  if (typeof location === "undefined" || !/^https?:$/.test(location.protocol)) return null;
  return location.port === "5180" ? `${location.protocol}//${location.hostname}:8787` : location.origin;
}

export class NetError extends Error {
  constructor(message: string, readonly status = 0) { super(message); }
}

type Listener = (p: Push) => void;

export class NetClient {
  me: Me | null = null;
  connected = false;
  /** The match this account is in, as last told by the server (a rejoin after a reload starts from it). */
  match: RoundView | null = null;
  searching = false;
  /** This session made or was handed its account just now (the game reloads once to move onto the server's save). */
  fresh = false;
  private token: string | null;
  private key: string;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private retry = 0;
  private timer = 0;
  private wanted = false;

  /** `profile` keeps a second account on the same device apart (?profile=2: two tabs, two players). */
  constructor(readonly base: string, profile = q.get("profile") ?? "") {
    this.key = `muster.net.${base}${profile ? `.${profile}` : ""}`;
    this.token = store.get(this.key);
    // A token handed to this player arrives once in the address (?token=...): keep it, then take it out of the address.
    const given = q.get("token");
    if (given) {
      this.useToken(given);
      q.delete("token");
      try { history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}`); } catch { /* not a page */ }
    }
  }

  /** Signs this device in as the holder of an issued token. */
  useToken(token: string) { this.token = token.trim(); store.set(this.key, this.token); this.fresh = true; }

  /** This device already has an account on this server. */
  get hasAccount() { return !!this.token; }

  async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    let r: Response;
    try {
      r = await fetch(this.base + path, {
        method, headers: { "content-type": "application/json", ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new NetError("Can't reach the server"); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new NetError(data?.error ?? "Something went wrong", r.status);
    return data as T;
  }

  /** Signs in (making the account on first use) and opens the socket. Safe to call again. */
  async start(defaultName = "Commander"): Promise<Me> {
    if (this.token) {
      try { this.me = await this.call<Me>("GET", "/v1/me"); } catch (e) { if ((e as NetError).status !== 401) throw e; this.token = null; }
    }
    if (!this.token) {
      const r = await this.call<{ token: string; me: Me }>("POST", "/v1/register", { name: defaultName, client: "web" });
      this.token = r.token; this.me = r.me;
      store.set(this.key, r.token);
      this.fresh = true;
    }
    this.wanted = true;
    this.open();
    return this.me!;
  }

  private open() {
    if (this.ws || !this.token) return;
    const ws = new WebSocket(this.base.replace(/^http/, "ws") + "/v1/ws");
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ t: "auth", token: this.token }));
    ws.onmessage = (e) => {
      let p: Push;
      try { p = JSON.parse(String(e.data)); } catch { return; }
      if (p.t === "hello") { this.connected = true; this.retry = 0; this.me = p.me; this.match = p.match; this.searching = p.queued; }
      else if (p.t === "queue") this.searching = p.searching;
      else if (p.t === "match_found") { this.match = p.view; this.searching = false; }
      else if (p.t === "match_over") this.match = null;
      for (const fn of [...this.listeners]) fn(p);
    };
    ws.onclose = () => {
      this.ws = null;
      this.connected = false;
      if (!this.wanted) return;
      this.timer = window.setTimeout(() => this.open(), Math.min(8000, 500 * 2 ** this.retry++));
    };
    ws.onerror = () => ws.close();
  }
  stop() { this.wanted = false; clearTimeout(this.timer); this.ws?.close(); }

  on(fn: Listener) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  rename = (name: string) => this.call<Me>("POST", "/v1/me", { name }).then((me) => (this.me = me));
  friends = () => this.call<FriendsView>("GET", "/v1/friends");
  addFriend = (code: string) => this.call<{ state: "sent" | "friends" | "already"; player: PlayerCard }>("POST", "/v1/friends/add", { code });
  respondFriend = (id: string, accept: boolean) => this.call<FriendsView>("POST", "/v1/friends/respond", { id, accept });
  removeFriend = (id: string) => this.call<FriendsView>("POST", "/v1/friends/remove", { id });
  joinQueue = () => this.call<{ searching: boolean }>("POST", "/v1/queue/join").then((r) => (this.searching = r.searching));
  leaveQueue = () => this.call("POST", "/v1/queue/leave").then(() => (this.searching = false));
  challenge = (friendId: string) => this.call<{ id: string; matched: boolean }>("POST", "/v1/challenge", { friendId });
  respondChallenge = (id: string, accept: boolean) => this.call<{ view: RoundView | null }>("POST", "/v1/challenge/respond", { id, accept });
  cancelChallenge = (id: string) => this.call("POST", "/v1/challenge/cancel", { id });
  currentMatch = () => this.call<{ view: RoundView | null }>("GET", "/v1/match").then((r) => (this.match = r.view));
  /** The server-held economy: the only coins, gems, cards and levels that count in ranked play. */
  account = () => this.call<AccountView>("GET", "/v1/account");
  upgrade = (kind: string) => this.call<AccountView>("POST", "/v1/account/upgrade", { kind });
  products = () => this.call<{ products: Product[] }>("GET", "/v1/store").then((r) => r.products);
  leaderboard = () => this.call<{ players: PlayerCard[] }>("GET", "/v1/leaderboard").then((r) => r.players);

  /** The calls a running match makes. */
  link(): NetLink {
    return {
      act: (action) => this.call("POST", "/v1/match/act", { action }),
      ready: (placements) => this.call("POST", "/v1/match/ready", { placements }),
      watched: (round) => this.call("POST", "/v1/match/watched", { round }),
      forfeit: () => this.call("POST", "/v1/match/forfeit"),
    };
  }
}

let client: NetClient | null | undefined;
/** The one client for this page, or null when no server is set for this build. */
export function net(): NetClient | null {
  if (client === undefined) { const base = serverUrl(); client = base ? new NetClient(base) : null; }
  return client;
}
