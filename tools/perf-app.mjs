// 24-unit battle frame gaps inside the real app (its WKWebView, full screen, native plugins) on the booted iOS Simulator.
// 1. Build the simulator app once: npm run build && node tools/cap-sync.mjs && xcodebuild -project ios/App/App.xcodeproj
//    -scheme App -configuration Release -sdk iphonesimulator -destination 'generic/platform=iOS Simulator'
//    -derivedDataPath ios/App/build/dd-release CODE_SIGNING_ALLOWED=NO build
// 2. Start this worktree's dev server: npx vite --host --port 5377 --strictPort
// 3. node tools/perf-app.mjs [port] [seconds] [level] [runs]
// It copies the built App.app to a temp folder, points that copy's Capacitor server.url at tools/perf-sim.html on the
// dev server (the bench needs the unbundled modules), installs and launches it, and prints what tools/perf-bench.js
// posts back. The repo's own app and config are untouched; reinstall the normal build afterwards if you need it.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [, , port = "5377", secs = "10", level = "1", runs = "1"] = process.argv;
const built = "ios/App/build/dd-release/Build/Products/Release-iphonesimulator/App.app";
if (!existsSync(built)) { console.error(`no simulator build at ${built} (see step 1 at the top of this file)`); process.exit(1); }
const appId = JSON.parse(readFileSync("app.config.json", "utf8")).bundleId;
const quiet = (...a) => { try { execFileSync("xcrun", ["simctl", ...a], { stdio: "ignore" }); } catch {} };
const sim = (...a) => execFileSync("xcrun", ["simctl", ...a], { stdio: ["ignore", "pipe", "inherit"] }).toString();

function once(n) {
  return new Promise((resolve, reject) => {
    const srv = createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(204, { "access-control-allow-origin": "*" }).end();
        if (req.method !== "POST") return;
        srv.close(); clearTimeout(timer);
        try { resolve(JSON.parse(body)); } catch { resolve({ raw: body }); }
      });
    });
    const timer = setTimeout(() => { srv.close(); reject(new Error("timed out waiting for the app")); }, 240000);
    srv.listen(0, "127.0.0.1", () => {
      const report = `http://127.0.0.1:${srv.address().port}/`;
      const dir = mkdtempSync(join(tmpdir(), "muster-perf-")), app = join(dir, "App.app");
      cpSync(built, app, { recursive: true });
      const cfgPath = join(app, "capacitor.config.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
      cfg.server = { url: `http://localhost:${port}/tools/perf-sim.html?secs=${secs}&level=${level}&report=${encodeURIComponent(report)}&t=${Date.now()}`, cleartext: true };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 1));
      quiet("terminate", "booted", appId);
      sim("install", "booted", app);
      sim("launch", "booted", appId);
      rmSync(dir, { recursive: true, force: true }); // simctl install copied it into the simulator
      console.error(`run ${n}: launched ${appId} -> ${cfg.server.url}`);
    });
  });
}

const all = [];
for (let i = 1; i <= Number(runs); i++) all.push({ run: i, where: "app", ...(await once(i)) });
quiet("terminate", "booted", appId);
console.log(JSON.stringify(Number(runs) === 1 ? all[0] : all, null, 1));
