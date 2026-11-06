# Meadow polish pass: before / after

Phone-size shots (390x844 @2x, iPhone 13 profile) from `PORT=<port> node tools/polish-shots.mjs outputs/review/polish <before|after>`.
`*-before.png` is the build before this pass. `*-after.png` is this branch.

| Fix | Shots | What changed |
| --- | --- | --- |
| Units read at board scale without crowding | `act1_*`, `act6_deploy`, `act7_3000`, `showcase*` | Small bodies still draw at 1.5x their collision size. Big ones (bulwark, ballista, bombard, golem) taper to 1.25x, so they no longer swamp the keeps (`spriteVis`, src/render/units.ts). Same-side ground bodies that would overlap on screen get a capped, eased, render-only nudge apart (src/render/spread.ts, max 0.2 world units), so a Blade Trio reads as three swords, not a blob. Deploy footprints use the same spacing, so Fight doesn't snap them. The sim is unchanged. |
| Acts 5-7 courtyards have height and texture | `act5_*`, `act6_*`, `act7_*` | Raised flagstone courtyards for Acts 5 and 7, snowfield relief for Act 6, re-rendered in Blender (commit bcc32ca). |
| Airborne VFX depth-sorted with bodies | `showcase*` (harriers over ground units) | Air VFX join the painter sort and hits on flyers play at flyer height (commit bcc32ca, tests/fx.test.ts). |
| Title key art uncrowded | `title-*`, `title-se-after.png` (320x568) | The key art is re-rendered with the camera frame raised (`shift_y 0.05`), so the keep flags and harriers clear the logo ribbon and there's open sky behind the logo. The secondary modes are now paired rows (Daily / Gauntlet, Breakpoint / Skirmish), so the menu sits low and the whole clash shows above it. Small phones get a smaller tagline (it used to cut to "CL...") and a tighter menu. |

Also: `tools/store-review.mjs` clicked `.menu .btn:nth-child(2)` for Gauntlet, which had been hitting Daily since Daily was added. It now clicks `.menu .gauntlet-btn`.
