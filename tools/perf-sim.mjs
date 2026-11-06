// 24-unit battle frame cost in the booted iOS Simulator's Safari (same WebKit as the app's WKWebView).
// Needs this worktree's dev server: npx vite --host --port 5377 --strictPort, then: node tools/perf-sim.mjs [port] [seconds] [level]
// Opens tools/perf-sim.html in the simulator, which runs tools/perf-bench.js and posts the numbers back here.
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
const [, , port = "5377", secs = "8", level = "1"] = process.argv;
const srv = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    res.writeHead(204, { "access-control-allow-origin": "*" }).end();
    if (req.method !== "POST") return;
    try { console.log(JSON.stringify(JSON.parse(body), null, 1)); } catch { console.log(body); }
    srv.close(); process.exit(0);
  });
});
srv.listen(0, "127.0.0.1", () => {
  const report = `http://127.0.0.1:${srv.address().port}/`;
  const url = `http://localhost:${port}/tools/perf-sim.html?secs=${secs}&level=${level}&report=${encodeURIComponent(report)}&t=${Date.now()}`;
  execFileSync("xcrun", ["simctl", "openurl", "booted", url]);
  console.error(`opened ${url}`);
});
setTimeout(() => { console.error("timed out waiting for the simulator"); process.exit(1); }, 240000);
