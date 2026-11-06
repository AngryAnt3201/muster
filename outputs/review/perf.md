# Muster 1.1: performance and size (measured 6-7 Nov 2026)

## Result

| Check | Target | Measured | Pass |
| --- | --- | --- | --- |
| 24-unit battle in the real app on the iPhone Simulator (frame gaps) | at least 55 fps | 56.6 - 57.3 fps (9 runs, 3 arenas) | yes |
| .app size, Release, device (arm64) | under 120 MB | 50.8 MB (49.3 MB zipped) | yes |
| .app size, Release, simulator | under 120 MB | 54.7 MB (50.3 MB zipped) | yes |

No texture compression or other fix was needed for either target.

## How the fps was measured

- Where: the Release `App.app` installed on the booted iPhone Simulator (iPhone 17 Pro, iOS 18.7, 402x874 points at 3x, canvas 1206x2622). It runs in the app's own WKWebView, full screen, with the native plugins loaded.
- Tool: `node tools/perf-app.mjs <port> 10 <level> 3`. It copies the built app, points the copy's Capacitor `server.url` at `tools/perf-sim.html` on the dev server, installs and launches it, and collects what `tools/perf-bench.js` posts back. The repo's own app and config are not touched.
- Battle: 12 units a side, 24 different kinds (the 24 newest, so all four 1.1 units are in), ranks 1-4, spread over both deploy zones. Every sprite sheet is tinted for both sides before the fight starts, and the bench waits until the main thread has been quiet for 2 s.
- Metric: the gap between consecutive `requestAnimationFrame` renders over 10 s of live battle. fps = frames / summed gaps. This is real frame pacing, not WebKit command-recording time. A frame counts as slow if its gap is over 18.2 ms (1000/55).

## Numbers (10 s per run, 3 runs each)

| Build | Arena | fps (r1 / r2 / r3) | gap median / p95 ms | slow frames |
| --- | --- | --- | --- | --- |
| This branch | Level 1 (Act 1 courtyard) | 57.0 / 57.1 / 56.7 | 17 / 21-22 | 6-7% |
| This branch | Level 40 (Act 7, raised flagstones) | 57.0 / 57.3 / 57.2 | 17 / 19-20 | 5-7% |
| This branch | Level 48 (Act 8 fen, Mother Wick) | 56.8 / 56.9 / 56.6 | 17 / 20-21 | 8-9% |
| `main` before the overnight run | Level 1 | 55.4 / 55.4 / 55.6 | 17 / 23-24 | 17-18% |
| `main` before the overnight run | Level 40 | 56.7 / 55.4 / 55.5 | 17 / 23-24 | 16-17% |

- Each run has one gap over 100 ms (124-140 ms), in both builds. It's a single stall, not repeated stutter.
- The sim's own step costs at most 3 ms a tick (median under 1 ms). The draw call itself is about 1 ms median, so the frame budget goes to WebKit compositing the 3x canvas.
- Raw results: `outputs/review/perf/app-{before,after}-L{1,40,48}-r{1,2,3}.json`.

## Load caveat and the 2x experiment

These numbers came from a Mac shared with Blender renders and other agents. When it was busier (load average 14-19), the Level 48 board at 3x dropped to 54.1 / 47.3 / 54.5 fps. A 2x canvas cap held 56.3 / 57.0 / 57.9 fps in the same hour (`outputs/review/perf/dpr-experiment/`).
A real iPhone doesn't share its CPU like that, so 3x ships unchanged. The 2x cap is a one-line change in `src/ui/game.ts`, `src/render/board.ts` and `src/render/units.ts` (`Math.min(3, devicePixelRatio)`). It's offered as a sign-off with a side-by-side comparison in `outputs/signoff/board-resolution/index.html`.

## Size

| Build | Total | Zipped | Web assets (`public/`) | Frameworks | Binary |
| --- | --- | --- | --- | --- | --- |
| Release, iphoneos arm64, unsigned (`ios/App/build/dd-device`) | 50.8 MB | 49.3 MB | 48.7 MB | 1.0 MB | 0.3 MB, arm64 |
| Release, iphonesimulator (`ios/App/build/dd-release`) | 54.7 MB | 50.3 MB | 48.7 MB (828 files) | 4.4 MB on disk | 0.6 MB |

- Both builds are from this branch at `98abbdd` (same JS bundle, `index-DM4DHtTw.js`).
- Most of the size is PNG art: character atlases 30 MB, arenas 10 MB, sprites 2.6 MB, VFX 1.5 MB, maps 1.5 MB. The committed `public/` grew from 42.1 MB on `main` to 48.4 MB (four new units, Act 8 arena and map).
- The App Store thins the binary per device and compresses the download, so the install will be close to these figures. It has about 70 MB of headroom under 120 MB.

## Re-running

```
npm run build && node tools/cap-sync.mjs
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/App/build/dd-release CODE_SIGNING_ALLOWED=NO build
npx vite --host --port 5377 --strictPort      # separate terminal
node tools/perf-app.mjs 5377 10 48 3          # level 48, 3 runs
```

`tools/perf-sim.mjs` runs the same bench in the simulator's Safari, and `tools/perf.mjs` runs it in Chromium as a desktop proxy. Use the app runner for the real number.
