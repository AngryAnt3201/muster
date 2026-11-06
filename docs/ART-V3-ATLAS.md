# Character atlases (v3)

Every unit (24 kinds, tiers 1 to 4) and every spawned body (mite, queen, golemling, thrall, turret, decoy at tier 1)
is built procedurally in Blender (`art/muster_art/units.py`) and rendered as upright frames for the 3/4 diorama board.

    npm run art                                   # render all (6 Blender workers), post, pack, contact sheets
    blender -b --factory-startup -P art/render_all.py -- --only ranger --tiers 1,4
    python3 art/post.py                           # re-ink + re-pack from existing raw renders
    blender ... -P art/render_all.py -- --resume --no-post   # finish an interrupted render (skips kind/tier with meta.json)
    python3 art/post.py --resume                  # post only bodies whose raw render is newer than their post
    python3 art/pack_atlas.py --sheets-only       # contact sheets from public/atlas only

`post.py` and `pack_atlas.py` need Pillow and numpy (`/usr/local/bin/python3` has them on Jack's Mac; put it first
on PATH when running `npm run art`).

## Style parameters

All look and camera numbers live in `art/muster_art/style.py`; swapping to the style direction Jack signs off is an
edit there plus a re-render. Nothing else keeps its own copy.

- Camera: orthographic, pitched `CAMERA_EL` = 53.3 degrees below the horizon, which is 90 degrees minus
  `TILT` (0.64 rad) in `src/render/camera.ts`, so a sprite's ground ellipse matches the board's.
- `PPU` = 128 atlas pixels per world unit, rendered at `SS` = 2x and box-downsampled.
- Toon ramp (3 cel bands), key light from the upper front, rim light from behind (`RIM_*`), inverted-hull
  outlines in 3D plus a 3 px ink silhouette added in post.
- Ascended (tier 4): an emissive pass becomes a team-coloured halo and bloom in post.

## Frames

- Facings: 5 rendered (`DIRS` = E, SE, S, NE, N in game angles, y down). West-side facings mirror their east twin.
  `DIR8[i]` maps an 8-way screen facing i (0 right, 1 down-right, 2 down = towards the camera, ... 6 up, 7 up-right)
  to `[rendered dir, mirrored]`. This equals `mirror8` in camera.ts.
- Animations (`ANIMS`): idle 2, walk 4, attack 3 (wind-up, strike, follow-through), death 3. Static bodies (mine,
  ballista, hive, bombard, turret) alias walk to idle. Harrier deaths tumble out of the air.
- Every frame is trimmed to its pixels and stores its ground anchor (the body's feet / base centre).

## Team colour

Team parts render in neutral white plus a mask with the coverage of team main (R), dark (G) and light (B). The runtime
tints once per sheet and team (`tintPixels` in `src/render/sprites.ts`):

    rgb = colour * (1 + R*(main - 1) + G*(dark - 1) + B*(light - 1))

## Files

- `public/atlas/<kind>_t<tier>.png`: colour, RGBA palette PNG, straight alpha.
- `public/atlas/<kind>_t<tier>_m.png`: team mask, same layout.
- `public/atlas/manifest.json`:

      { version: 3, ppu, el, dirs, dir8, anims, teams: { tide, ember },
        units: { <kind>: { tiers: [1..4], radius } },
        sheets: { <kind>_t<tier>: { w, h, anims: { idle: [dir][frame] = [x, y, w, h, ax, ay], walk: ... | "idle" } } } }

- Contact sheets in `art/contact/`: `v3_tiers_<team>.png` (every body at tiers 1 to 4, true scale, one facing),
  `v3_tiers_tide_attack.png`, `v3_tiers_ember_north.png`, and `v3_anim_<kind>_t<tier>.png` (8 facings x every frame).

## Runtime

`BoardView.token()` draws `frame(kind, tier, side, anim, phase, cam.facing8(face, y))` with its anchor on
`cam.project(x, y, z)` at `cam.scaleAt(y) * SPRITE_VIS / ppu` screen px per atlas px. `animFor()` in units.ts picks
the animation: death while dying, attack during a swing, walk when moving, else idle. Until a sheet has loaded and
tinted, the drawn token stands in. Card portraits stay in `public/portraits`.
