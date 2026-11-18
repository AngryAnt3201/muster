// Starts the Muster match server.  npm run server   (PORT, MUSTER_DB, MUSTER_ADMIN_KEY, MUSTER_INVITE_ONLY, MUSTER_HOUSE_BOTS, MUSTER_PAYMENT_SECRET, TRUST_PROXY)
import { mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, resolve } from "node:path";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? 8787);
const db = resolve(process.env.MUSTER_DB ?? "server/data/muster.db");
mkdirSync(dirname(db), { recursive: true });
const app = createApp({
  db,
  staticDir: resolve(process.env.MUSTER_STATIC ?? "dist"),
  adminKey: process.env.MUSTER_ADMIN_KEY || undefined,
  inviteOnly: process.env.MUSTER_INVITE_ONLY === "1",
  houseBots: Number(process.env.MUSTER_HOUSE_BOTS ?? 16),
  paymentSecret: process.env.MUSTER_PAYMENT_SECRET || undefined,
  trustProxy: process.env.TRUST_PROXY === "1",
});
app.server.listen(port, "0.0.0.0", () => {
  const lan = Object.values(networkInterfaces()).flat().find((n) => n && n.family === "IPv4" && !n.internal)?.address;
  console.log(`Muster server on http://localhost:${port}${lan ? `  (same Wi-Fi: http://${lan}:${port})` : ""}`);
});
const stop = () => void app.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
