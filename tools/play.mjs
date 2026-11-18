#!/usr/bin/env node
// One command to get playing.  npm run play [-- options]
//
//   npm run play                      the game on this machine: match server + game, browser opens on Versus
//   npm run play -- --add K7QF2M      ...and send that player a friend request on arrival
//   npm run play -- --token mst_...   sign in with the token you were given (invite-only servers)
//   npm run play -- --two             also opens a second player in another tab (try a match against yourself)
//   npm run play -- --server <url>    use a match server that is already running somewhere (no local one)
//   npm run play -- --tunnel          host for friends anywhere: builds the game, serves it with the match server on
//                                     one port and opens a public Cloudflare tunnel to it (needs `cloudflared`)
//   --no-open                         do not open a browser
//
// With a hosted server set in server.config.json, plain `npm run play` uses it: every clone lands in the same world.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const value = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const say = (s) => console.log(`\x1b[1m[muster]\x1b[0m ${s}`);
const die = (s) => { console.error(`\x1b[31m[muster]\x1b[0m ${s}`); process.exit(1); };

const major = Number(process.versions.node.split(".")[0]);
if (major < 22 || (major === 22 && Number(process.versions.node.split(".")[1]) < 13)) die(`Node 22.13 or newer is needed (this is ${process.versions.node}). Install it from https://nodejs.org or with: brew install node`);
if (!existsSync("node_modules/vite") || !existsSync("node_modules/ws")) {
  say("Installing packages (first run only)...");
  if (spawnSync("npm", ["install", "--no-audit", "--no-fund"], { stdio: "inherit" }).status !== 0) die("npm install failed.");
}

const kids = [];
const run = (cmd, argv, env = {}, quiet = true) => {
  const k = spawn(cmd, argv, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  kids.push(k);
  let out = "";
  const on = (d) => { out += d; if (!quiet) process.stdout.write(d); };
  k.stdout.on("data", on); k.stderr.on("data", on);
  k.on("exit", (code) => { if (code && !stopping) { console.error(out.slice(-2000)); die(`${cmd} ${argv.join(" ")} stopped (${code}).`); } });
  return { k, text: () => out };
};
let stopping = false;
const stop = () => { stopping = true; for (const k of kids) k.kill("SIGTERM"); process.exit(0); };
process.on("SIGINT", stop); process.on("SIGTERM", stop);

const up = async (url, secs = 60) => {
  for (let i = 0; i < secs * 4; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};
const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
const open = (url) => { if (!flag("no-open")) spawn(process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open", [url], { stdio: "ignore", shell: process.platform === "win32", detached: true }).unref(); };
const query = (extra = {}) => { const q = new URLSearchParams({ ...(value("token") ? { token: value("token") } : {}), ...(value("add") ? { add: value("add") } : { versus: "" }), ...extra }); return `?${q}`.replace(/=(&|$)/g, "$1"); };
const bin = (n) => resolve("node_modules/.bin", n);

let hosted = value("server") ?? process.env.VITE_MUSTER_SERVER ?? "";
if (!hosted) { try { hosted = JSON.parse(readFileSync("server.config.json", "utf8")).url ?? ""; } catch { /* none */ } }
hosted = hosted.replace(/\/+$/, "");

if (flag("tunnel")) {
  // One port for everything, so one public address is enough: friends just open the link, nothing to install.
  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status !== 0) die("`cloudflared` is not installed. On a Mac: brew install cloudflared");
  say("Building the game...");
  if (spawnSync("npm", ["run", "build"], { stdio: "inherit", env: { ...process.env, VITE_MUSTER_SERVER: "" } }).status !== 0) die("Build failed.");
  const port = process.env.PORT ?? "8787";
  run(bin("vite-node"), ["server/main.ts"], { PORT: port, TRUST_PROXY: "1" }); // the tunnel passes each visitor's address on
  if (!(await up(`http://localhost:${port}/health`))) die("The match server did not start.");
  const t = run("cloudflared", ["tunnel", "--url", `http://localhost:${port}`]);
  let url = "";
  for (let i = 0; i < 120 && !url; i++) { url = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(t.text())?.[0] ?? ""; await new Promise((r) => setTimeout(r, 250)); }
  if (!url) die("The tunnel did not come up.");
  say(`Muster is ready. You: http://localhost:${port}/${query()}`);
  say(`Friends anywhere, in a browser (nothing to install):  ${url}/?versus`);
  say(`Friends who cloned the game:  npm run play -- --server ${url}`);
  say("The link works while this window stays open. Ctrl+C stops it.");
  open(`http://localhost:${port}/${query()}`);
} else {
  if (!hosted) {
    run(bin("vite-node"), ["server/main.ts"]);
    if (!(await up("http://localhost:8787/health"))) die("The match server did not start (is something else on port 8787?).");
  } else if (!(await up(`${hosted}/health`, 10))) die(`Can't reach the match server at ${hosted}.`);
  run(bin("vite"), ["--host", "0.0.0.0", "--port", "5180", "--strictPort"], { VITE_MUSTER_SERVER: hosted });
  if (!(await up("http://localhost:5180/"))) die("The game did not start (is something else on port 5180?).");
  say(`Muster is ready: http://localhost:5180/${query()}`);
  say(hosted ? `Match server: ${hosted}` : "Match server: this machine (port 8787). Friends on other networks need --tunnel or a hosted server.");
  if (!hosted && lan) say(`Phones and laptops on the same Wi-Fi: http://${lan}:5180/?versus`);
  say("In the game: Modes, Versus. Your friend code is on that screen. Ctrl+C stops everything.");
  open(`http://localhost:5180/${query()}`);
  if (flag("two")) setTimeout(() => open(`http://localhost:5180/${query({ profile: "2" })}`), 1200);
}
