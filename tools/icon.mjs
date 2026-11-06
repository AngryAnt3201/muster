// Renders the 1024px app icon: two tokens, Tide and Ember, crossing blades over a dusk board.
import { chromium } from "playwright";
const out = process.argv[2] ?? "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(`<canvas id=c width=1024 height=1024></canvas><script>
const c=document.getElementById('c').getContext('2d');
const g=c.createRadialGradient(512,420,80,512,512,720);g.addColorStop(0,'#24324a');g.addColorStop(1,'#0a0e16');c.fillStyle=g;c.fillRect(0,0,1024,1024);
c.strokeStyle='rgba(160,190,220,0.08)';c.lineWidth=6;for(let k=0;k<9;k++){c.beginPath();for(let i=0;i<=40;i++){const u=i/40;const y=80+k*110+Math.sin(u*7+k)*30;i?c.lineTo(u*1024,y):c.moveTo(u*1024,y);}c.stroke();}
function tok(x,y,r,a,b,d){const gg=c.createRadialGradient(x-r*.35,y-r*.35,r*.1,x,y,r);gg.addColorStop(0,a);gg.addColorStop(.45,b);gg.addColorStop(1,d);c.fillStyle=gg;c.beginPath();c.arc(x,y,r,0,7);c.fill();c.lineWidth=22;c.strokeStyle='#0a0e16';c.stroke();}
function sword(x0,y0,x1,y1){c.lineCap='round';c.strokeStyle='#0a0e16';c.lineWidth=74;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();c.strokeStyle='#eef3f8';c.lineWidth=44;c.beginPath();c.moveTo(x0,y0);c.lineTo(x1,y1);c.stroke();}
sword(300,760,760,250);sword(724,760,264,250);
c.fillStyle='rgba(255,210,120,0.9)';c.beginPath();c.arc(512,505,46,0,7);c.fill();
tok(300,760,150,'#a6fff6','#3fd0c9','#167c7a');tok(724,760,150,'#ffc1ad','#ff6a4d','#a8331f');
</script>`);
await page.waitForTimeout(200);
await page.locator("#c").screenshot({ path: out });
await browser.close();
console.log("icon ->", out);
