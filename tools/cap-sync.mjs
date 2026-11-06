// `cap sync ios`, with the local StoreKit plugin (ios/MusterStore, npm name muster-store) always resolvable.
// npm links it into node_modules on `npm install`; until then (or where node_modules is shared with another
// checkout, as in agent worktrees) plain `cap sync` quietly drops it and the app ships with no store.
// NODE_PATH is Node's last-resort lookup, so an installed link still wins and this only fills the gap.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const links = join(root, "ios/App/build/node-links"); // ios/App/build is git-ignored
mkdirSync(links, { recursive: true });
const link = join(links, "muster-store");
rmSync(link, { force: true });
symlinkSync(join(root, "ios/MusterStore"), link, "dir");

const env = { ...process.env, NODE_PATH: [links, process.env.NODE_PATH].filter(Boolean).join(delimiter) };
const r = spawnSync("npx", ["cap", "sync", "ios", ...process.argv.slice(2)], { cwd: root, stdio: "inherit", env });
if (r.status !== 0) process.exit(r.status ?? 1);

// Capacitor skips a plugin it can't resolve without failing, which would ship a build with no store.
const spm = readFileSync(join(root, "ios/App/CapApp-SPM/Package.swift"), "utf8");
if (!spm.includes('.product(name: "MusterStore", package: "MusterStore")')) {
  console.error("cap-sync: the MusterStore plugin is missing from ios/App/CapApp-SPM/Package.swift. Run npm install, then try again.");
  process.exit(1);
}
