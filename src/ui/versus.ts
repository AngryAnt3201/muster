// Versus: play another person. Your name and friend code, Find match (ranked), and your friends with a Challenge button.
// main.ts owns navigation: it passes in the way back and how to start a match.
import "./versus.css";
import { sfx, unlockAudio } from "../audio/sfx";
import type { NetClient } from "../net/client";
import { leagueOf } from "../net/ladder";
import { NAME_MAX, type FriendsView, type PlayerCard, type Push } from "../net/protocol";
import { el } from "./dom";
import { icon } from "./kit";

export interface VersusOpts {
  app: HTMLElement;
  net: NetClient | null;
  back: () => void;
  /** A friend code to add on arrival (an invite link: ?add=CODE). */
  add?: string | null;
}

function tap<T extends HTMLElement>(b: T, fn: () => void): T {
  b.addEventListener("click", () => { unlockAudio(); sfx("tap"); fn(); });
  return b;
}
const button = (label: string | Node, cls: string, fn: () => void) => tap(el("button", { class: `btn ${cls}` }, [label]) as HTMLButtonElement, fn);

async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not a secure page (a LAN address): the old way */ }
  const t = el("textarea", { style: "position:fixed;opacity:0" }) as HTMLTextAreaElement;
  t.value = text; document.body.append(t); t.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* no clipboard at all */ }
  t.remove();
  return ok;
}

/** Draws the Versus screen into `app`. Returns a function that stops it listening (call when leaving the screen). */
export function versusScreen(o: VersusOpts): () => void {
  const { app, net } = o;
  const back = tap(el("button", { class: "icon-btn back", "aria-label": "Back" }, [icon("back")]), o.back);
  const rating = el("span", { class: "star-total vs-rating" });
  const body = el("div", { class: "vs-body" });
  const scr = el("div", { class: "screen versus" }, [el("div", { class: "screen-head" }, [back, el("h1", {}, ["Versus"]), rating]), body]);
  app.append(scr);
  let alive = true, off = () => {};
  const stop = () => { alive = false; off(); if (net?.searching) void net.leaveQueue().catch(() => undefined); };

  const note = el("div", { class: "vs-note", role: "status" });
  let noteT = 0;
  const say = (text: string, bad = false) => {
    note.textContent = text; note.className = `vs-note show ${bad ? "bad" : ""}`;
    clearTimeout(noteT); noteT = window.setTimeout(() => { note.className = "vs-note"; }, 2600);
    if (bad) sfx("deny");
  };
  const attempt = async (fn: () => Promise<unknown>) => { try { await fn(); return true; } catch (e) { if (alive) say((e as Error).message, true); return false; } };

  if (!net) {
    body.append(el("div", { class: "panel" }, [el("p", { class: "lead" }, ["Online play is not switched on in this build yet."])]));
    return stop;
  }

  const youPanel = el("div", { class: "panel vs-you" });
  const friendsBox = el("div", { class: "vs-friends" });
  body.append(el("div", { class: "panel" }, [el("p", { class: "lead" }, ["Finding the server..."])]));

  function drawYou() {
    const me = net!.me!;
    rating.replaceChildren(icon("crown"), String(me.rating));
    const name = el("input", { class: "vs-input vs-name", value: me.name, maxlength: String(NAME_MAX), "aria-label": "Your name", autocomplete: "off", spellcheck: "false" }) as HTMLInputElement;
    const saveName = () => { const v = name.value.trim(); if (v && v !== net!.me!.name) void attempt(() => net!.rename(v)).then((ok) => { if (ok) say("Name saved"); else name.value = net!.me!.name; }); };
    name.addEventListener("change", saveName);
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") name.blur(); });
    const link = /^https?:$/.test(location.protocol) ? `${location.origin}${location.pathname}?add=${me.code}` : me.code;
    const find = el("button", { class: `btn primary big vs-find ${net!.searching ? "searching" : ""}` }, [
      el("span", {}, [el("b", {}, [net!.searching ? "Searching" : "Find match"]), el("small", {}, [net!.searching ? "Tap to cancel" : `Ranked · ${me.rating} trophies`])]),
    ]);
    tap(find, () => void attempt(() => (net!.searching ? net!.leaveQueue() : net!.joinQueue())).then(drawYou));
    youPanel.replaceChildren(
      el("label", { class: "vs-field" }, [el("small", {}, ["Your name"]), name]),
      el("div", { class: "vs-code-row" }, [
        el("div", { class: "vs-field" }, [el("small", {}, ["Friend code"]), el("b", { class: "vs-code" }, [me.code])]),
        button("Copy invite", "small ghost", () => void copy(link).then((ok) => say(ok ? "Invite copied" : me.code))),
      ]),
      el("div", { class: "vs-record" }, [el("span", {}, [el("b", {}, [leagueOf(me.rating).name]), "league"]), el("span", {}, [el("b", {}, [String(me.wins)]), "wins"]), el("span", {}, [el("b", {}, [String(me.losses)]), "losses"])]),
      find,
    );
  }

  const row = (p: PlayerCard, right: (Node | string)[], cls = "") => el("div", { class: `vs-row ${cls}` }, [
    el("i", { class: `vs-dot ${p.online ? (p.inMatch ? "busy" : "on") : ""}` }),
    el("div", { class: "vs-who" }, [el("b", {}, [p.name, ...(p.bot ? [el("i", { class: "vs-bot" }, ["bot"])] : [])]), el("small", {}, [p.inMatch ? "In a match" : p.online ? `${leagueOf(p.rating).name} · ${p.rating}` : "Offline"])]),
    el("div", { class: "vs-acts" }, right),
  ]);

  let waiting: string | null = null; // the challenge we sent and are waiting on
  function drawFriends(f: FriendsView) {
    const code = el("input", { class: "vs-input vs-add", placeholder: "Friend code", maxlength: "6", "aria-label": "Friend code", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" }) as HTMLInputElement;
    const add = () => { const c = code.value.trim(); if (c) void addByCode(c).then(() => { code.value = ""; }); };
    code.addEventListener("keydown", (e) => { if (e.key === "Enter") add(); });
    const kids: Node[] = [el("div", { class: "vs-add-row" }, [code, button("Add", "small", add)])];
    for (const c of f.challenges) kids.push(row(c.from, [
      button("Accept", "small primary", () => void attempt(() => net!.respondChallenge(c.id, true))),
      button("No", "small ghost", () => void attempt(() => net!.respondChallenge(c.id, false)).then(refresh)),
    ], "challenge"));
    for (const p of f.incoming) kids.push(row(p, [
      button("Accept", "small primary", () => void attempt(() => net!.respondFriend(p.id, true)).then(refresh)),
      button("No", "small ghost", () => void attempt(() => net!.respondFriend(p.id, false)).then(refresh)),
    ], "request"));
    for (const p of f.friends) {
      const mine = waiting === p.id;
      kids.push(row(p, [
        mine
          ? button("Cancel", "small ghost", () => { waiting = null; void attempt(() => net!.cancelChallenge(sent)).then(refresh); })
          : Object.assign(button("Challenge", "small gold", () => void challenge(p)), { disabled: !p.online || !!p.inMatch }),
      ]));
    }
    for (const p of f.outgoing) kids.push(row(p, [el("small", { class: "vs-pending" }, ["Asked"])], "pending"));
    if (!f.friends.length && !f.incoming.length && !f.outgoing.length) kids.push(el("p", { class: "vs-empty" }, ["Send a friend your invite, or type their code."]));
    friendsBox.replaceChildren(el("h2", {}, ["Friends"]), ...kids);
  }
  const ladderBox = el("div", { class: "vs-friends vs-ladder" });
  async function drawExtras() {
    if (!alive) return;
    try {
      const top = await net!.leaderboard();
      if (!alive) return;
      ladderBox.replaceChildren(el("h2", {}, ["Ladder"]), ...top.slice(0, 20).map((p, i) => el("div", { class: `vs-row ${p.id === net!.me!.id ? "challenge" : ""}` }, [
        el("b", { class: "vs-rank" }, [String(i + 1)]),
        el("div", { class: "vs-who" }, [el("b", {}, [p.name, ...(p.bot ? [el("i", { class: "vs-bot" }, ["bot"])] : [])]), el("small", {}, [leagueOf(p.rating).name])]),
        el("b", { class: "vs-trophies" }, [String(p.rating)]),
      ])));
    } catch { /* the next refresh draws them */ }
  }
  let sent = "";
  async function challenge(p: PlayerCard) {
    await attempt(async () => {
      const r = await net!.challenge(p.id);
      if (!r.matched) { waiting = p.id; sent = r.id; say(`Challenge sent to ${p.name}`); }
    });
    void refresh();
  }
  async function addByCode(raw: string) {
    await attempt(async () => {
      const r = await net!.addFriend(raw);
      say(r.state === "friends" ? `You and ${r.player.name} are friends` : r.state === "already" ? `Already asked ${r.player.name}` : `Asked ${r.player.name}`);
    });
    await refresh();
  }
  async function refresh() {
    if (!alive) return;
    try { const f = await net!.friends(); if (alive) drawFriends(f); } catch { /* the socket's reconnect redraws */ }
  }

  void (async () => {
    try { await net.start(`Commander ${100 + Math.floor(Math.random() * 900)}`); } catch (e) {
      if (!alive) return;
      const again = () => { stop(); scr.remove(); versusScreen(o); };
      if ((e as { status?: number }).status === 403 || (e as { status?: number }).status === 401) {
        // An invite-only server: the player signs in with the token they were given.
        const token = el("input", { class: "vs-input vs-token", placeholder: "mst_...", "aria-label": "Your token", autocomplete: "off", autocapitalize: "off", spellcheck: "false" }) as HTMLInputElement;
        const enter = () => { const t = token.value.trim(); if (t) { net.useToken(t); again(); } };
        token.addEventListener("keydown", (ev) => { if (ev.key === "Enter") enter(); });
        body.replaceChildren(el("div", { class: "panel" }, [
          el("p", { class: "lead" }, ["This server is invite only."]),
          el("label", { class: "vs-field" }, [el("small", {}, ["Paste your token"]), token]),
          button("Enter", "primary big", enter),
        ]));
        return;
      }
      body.replaceChildren(el("div", { class: "panel" }, [
        el("p", { class: "lead" }, ["Can't reach the match server."]),
        el("p", { class: "vs-empty" }, [(e as Error).message === "Can't reach the server" ? `Tried ${net.base}` : (e as Error).message]),
        button("Try again", "primary big", again),
      ]));
      return;
    }
    // A first sign-in: load the game again so every screen and the Shop run on the server's account from the start.
    if (net.fresh) {
      const q = new URLSearchParams(location.search);
      q.delete("token");
      if (!q.has("add")) q.set("versus", "");
      location.replace(`${location.pathname}?${q}`);
      return;
    }
    if (!alive) return;
    body.replaceChildren(youPanel, friendsBox, ladderBox, note);
    drawYou();
    await refresh();
    void drawExtras();
    if (o.add && o.add.toUpperCase() !== net.me!.code) await addByCode(o.add);
    off = net.on((p: Push) => {
      if (p.t === "hello" || p.t === "queue") drawYou();
      if (p.t === "hello" || p.t === "match_over") void drawExtras();
      if (p.t === "challenge_gone" && p.id === sent) { if (waiting && p.why !== "cancelled") say(p.why === "declined" ? "They said no" : "No answer", true); waiting = null; }
      if (p.t === "hello" || p.t === "friends" || p.t === "presence" || p.t === "challenge" || p.t === "challenge_gone" || p.t === "match_over") void refresh();
    });
  })();
  return stop;
}

/** The body of the sheet shown anywhere in the menus when a friend challenges you. */
export function challengeSheet(from: PlayerCard, accept: () => void, decline: () => void): HTMLElement {
  return el("div", { class: "vs-challenge" }, [
    el("div", { class: "sheet-kicker" }, ["Challenge"]),
    el("h2", {}, [from.name]),
    el("p", { class: "flavour" }, [`${leagueOf(from.rating).name} · wants a friendly match`]),
    button("Fight", "primary big", accept),
    button("Not now", "ghost", decline),
  ]);
}
