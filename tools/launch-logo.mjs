// Renders the launch-screen logo (crossed blades over a Tide and an Ember token, MUSTER wordmark) at @2x and @3x
// into ios/App/App/Assets.xcassets/LaunchLogo.imageset. Transparent background: the storyboard paints the ink.
// Run: node tools/launch-logo.mjs [WORDMARK]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const word = (process.argv[2] ?? "MUSTER").toUpperCase();
const dir = new URL("../ios/App/App/Assets.xcassets/LaunchLogo.imageset/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
const rounded = "/System/Library/Fonts/SFNSRounded.ttf"; // the in-app font (ui-rounded) on this Mac
const face = existsSync(rounded) ? `@font-face{font-family:"SF Pro Rounded";src:url(data:font/ttf;base64,${readFileSync(rounded).toString("base64")});font-weight:1 1000}` : "";

const html = `<style>${face}
html,body{margin:0;background:transparent}
.l{width:240px;height:160px;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:"SF Pro Rounded",ui-rounded,system-ui,sans-serif}
canvas{width:92px;height:72px}
.w{margin-top:2px;font-size:54px;font-weight:900;letter-spacing:.06em;line-height:1;padding-left:.06em;background:linear-gradient(#fff 20%,#9dfff7 55%,#3fd0c9);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 3px 0 #0b3b3a)}
</style><div class=l><canvas id=c width=368 height=288></canvas><div class=w>${word}</div></div>
<script>
const c=document.getElementById('c').getContext('2d');c.scale(4,4);
function tok(x,y,r,a,b,d){const g=c.createRadialGradient(x-r*.35,y-r*.35,r*.1,x,y,r);g.addColorStop(0,a);g.addColorStop(.45,b);g.addColorStop(1,d);c.fillStyle=g;c.beginPath();c.arc(x,y,r,0,7);c.fill();c.lineWidth=2.4;c.strokeStyle='#0b0f17';c.stroke();}
function sword(x0,y0,x1,y1){c.lineCap='round';c.strokeStyle='#0b0f17';c.lineWidth=8;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();c.strokeStyle='#eef3f8';c.lineWidth=4.6;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();}
sword(26,58,70,10);sword(66,58,22,10);
c.fillStyle='rgba(255,210,120,0.95)';c.beginPath();c.arc(46,36.2,4.6,0,7);c.fill();
tok(24,56,14,'#a6fff6','#3fd0c9','#167c7a');tok(68,56,14,'#ffc1ad','#ff6a4d','#a8331f');
</script>`;

const browser = await chromium.launch();
for (const scale of [2, 3]) {
  const page = await browser.newPage({ viewport: { width: 240, height: 160 }, deviceScaleFactor: scale });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  await page.locator(".l").screenshot({ path: `${dir}LaunchLogo@${scale}x.png`, omitBackground: true });
  await page.close();
}
await browser.close();
writeFileSync(`${dir}Contents.json`, JSON.stringify({
  images: [
    { idiom: "universal", scale: "1x" },
    { idiom: "universal", filename: "LaunchLogo@2x.png", scale: "2x" },
    { idiom: "universal", filename: "LaunchLogo@3x.png", scale: "3x" },
  ],
  info: { author: "xcode", version: 1 },
}, null, 2) + "\n");
console.log("launch logo ->", dir);
