import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "co.inflect.muster",
  appName: "Muster",
  webDir: "dist",
  backgroundColor: "#0b0f17",
  ios: { contentInset: "never", backgroundColor: "#0b0f17", preferredContentMode: "mobile", scrollEnabled: false },
  plugins: { StatusBar: { style: "DARK", overlaysWebView: true } },
};
export default config;
