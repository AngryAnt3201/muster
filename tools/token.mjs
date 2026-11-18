#!/usr/bin/env node
// Issue, list and revoke player tokens on the match server.  Needs MUSTER_ADMIN_KEY (the same value the server runs with).
//
//   npm run token -- "Sam"                    a token for Sam, and the one line to send them
//   npm run token -- "Sam" --friend K7QF2M    ...already friends with the player who has that code (you)
//   npm run token -- "Sam's bot" --bot         a token for a script: it plays ranked but stays in the lower leagues
//   npm run token -- --list                   everyone with a token
//   npm run token -- --revoke <code or id>    switch a token off (they drop out of any match)
//   npm run token -- --clear <code or id>     a person wrongly counted as scripted: wipe their flags
//   npm run token -- --grant <code> --gems 500 [--coins 0] [--note prize]   credit an account by hand
//   --server <url>                            which server (default: server.config.json, else http://localhost:8787)
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const die = (s) => { console.error(s); process.exit(1); };
const key = process.env.MUSTER_ADMIN_KEY || die("Set MUSTER_ADMIN_KEY to the server's admin key.");
let server = value("server") ?? process.env.VITE_MUSTER_SERVER ?? "";
if (!server) { try { server = JSON.parse(readFileSync("server.config.json", "utf8")).url ?? ""; } catch { /* none */ } }
server = (server || "http://localhost:8787").replace(/\/+$/, "");

async function call(method, path, body) {
  let r;
  try { r = await fetch(server + path, { method, headers: { "content-type": "application/json", "x-admin-key": key }, body: body ? JSON.stringify(body) : undefined }); }
  catch { die(`Can't reach ${server}`); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) die(r.status === 404 && path.startsWith("/v1/admin") && !data.error?.startsWith("No ") ? `Refused by ${server}: wrong admin key, or the server has none set.` : data.error ?? `Failed (${r.status})`);
  return data;
}

if (args.includes("--list")) {
  const { players } = await call("GET", "/v1/admin/players");
  for (const p of players) console.log(`${p.code}  ${p.name.padEnd(16)}  ${p.kind.padEnd(5)}  ${String(p.rating).padStart(4)} trophies  ${p.wins}W ${p.losses}L${p.online ? "  online" : ""}${p.flags ? `  flagged x${p.flags}` : ""}${p.revoked ? "  REVOKED" : ""}`);
  console.log(`${players.length} player${players.length === 1 ? "" : "s"} on ${server}`);
} else if (value("revoke")) {
  const r = await call("POST", "/v1/admin/revoke", { player: value("revoke") });
  console.log(`Revoked ${r.name}'s token.`);
} else if (value("clear")) {
  const r = await call("POST", "/v1/admin/clear-flags", { player: value("clear") });
  console.log(`Cleared ${r.name}'s flags.`);
} else if (value("grant")) {
  const r = await call("POST", "/v1/admin/grant", { player: value("grant"), gems: Number(value("gems") ?? 0), coins: Number(value("coins") ?? 0), note: value("note") ?? "" });
  console.log(`Granted. They now hold ${r.account.coins} coins and ${r.account.gems} gems.`);
} else {
  const name = args.find((a, i) => !a.startsWith("--") && !["--friend", "--server"].includes(args[i - 1])) ?? die('Who is it for?  npm run token -- "Sam"');
  const r = await call("POST", "/v1/admin/tokens", { name, friend: value("friend"), bot: args.includes("--bot") });
  let repo = "<repo-url>";
  try { repo = execSync("git remote get-url origin", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || repo; } catch { /* no remote yet */ }
  console.log(`Token for ${r.me.name} (friend code ${r.me.code}). It is shown once: only its hash is stored.\n\n  ${r.token}\n`);
  console.log(`Send them this line:\n\n  git clone ${repo} muster && cd muster && claude "/play ${r.token}"\n`);
  console.log(`Without Claude:  git clone ${repo} muster && cd muster && npm run play -- --token ${r.token}`);
}
