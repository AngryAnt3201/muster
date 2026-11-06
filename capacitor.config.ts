import type { CapacitorConfig } from "@capacitor/cli";
import { readFileSync } from "node:fs";

// Name and bundle id live in app.config.json (the cap CLI always runs from the repo root).
const app = JSON.parse(readFileSync("app.config.json", "utf8")) as { bundleId: string; displayName: string };

const config: CapacitorConfig = {
  appId: app.bundleId,
  appName: app.displayName,
  webDir: "dist",
  backgroundColor: "#0b0f17",
  ios: { contentInset: "never", backgroundColor: "#0b0f17", preferredContentMode: "mobile", scrollEnabled: false },
  plugins: { StatusBar: { style: "DARK", overlaysWebView: true } },
};
export default config;
