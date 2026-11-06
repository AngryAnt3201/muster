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

All look and camera numbers live in `art/muster_art/style.py`; nothing else keeps its own copy. Its constants hold the
built-in v2 look, and at import `select()` replaces the look ones with a style direction (`art/style/<id>.json`,
docs/ART-V3.md):

    MUSTER_STYLE=<id> or --style <id>    meadow, dusk or toy
    MUSTER_STYLE=v2 or --style v2        the built-in v2 look
    (neither)                            the active direction in art/style/active.json

So once Jack picks: `npm run style:pick -- <id>`, then `npm run art` (with `/usr/local/bin/python3` first on PATH).
What a direction sets: `outline.color` -> `INK`, `outline.hull` -> `OUTLINE` (0 = no hull lines, Painted Toy),
`outline.silhouette_px` -> `INK_PX` (x `SS`, post inks at raw size), `shading.bands` -> `RAMP` over N.L in -0.2..1
(`RAMP_DOT`), `shading.shadow_tint*` -> `SHADOW_TINT*` (tints the dark bands in the kit's Toon group), `shading.spec`
-> `SPEC`, `shading.bloom` -> `GLOW_GAIN` (relative to meadow's 0.7), `light.key` / `rim.dir` (Blender world) ->
`KEY` / `RIM_DIR` (camera space), `rim.*` -> `RIM_*`, `team` -> `TEAMS`, `palette` -> `PALETTE` (`parts.Pal`
materials). The camera and frame plan never change with a direction, because `CAMERA_EL`, `DIRS` and `ANIMS` are what
`src/render/camera.ts` and `tests/atlas.test.ts` check against (the direction contract's 55 / 35 degree elevations
are not used for characters).

`render_all.py` writes the style into every raw `meta.json`. `post.py` (and `pack_atlas.py`, which imports it) posts
in the style the raw renders record unless `--style` / `MUSTER_STYLE` says otherwise, and stops if the raw renders mix
styles, so a partial re-render can't ink one unit in another direction's colours. The manifest records `style`.
The shipped atlases are `"style": "v2"` until the full re-render after the pick.

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
tints once per sheet and team (`tintPixels` in `src/render/sprites.ts`) with the active direction's team colours
(`TEAM` in `src/render/palette.ts`), so units match the UI even before a re-render:

    rgb = colour * (1 + R*(main - 1) + G*(dark - 1) + B*(light - 1))

## Files

- `public/atlas/<kind>_t<tier>.png`: colour, RGBA palette PNG, straight alpha.
- `public/atlas/<kind>_t<tier>_m.png`: team mask, same layout.
- `public/atlas/manifest.json`:

      { version: 3, style, ppu, el, dirs, dir8, anims, teams: { tide, ember },
        units: { <kind>: { tiers: [1..4], radius } },
        sheets: { <kind>_t<tier>: { w, h, anims: { idle: [dir][frame] = [x, y, w, h, ax, ay], walk: ... | "idle" } } } }

- Contact sheets in `art/contact/`: `v3_tiers_<team>.png` (every body at tiers 1 to 4, true scale, one facing),
  `v3_tiers_tide_attack.png`, `v3_tiers_ember_north.png`, and `v3_anim_<kind>_t<tier>.png` (8 facings x every frame).

## Runtime

`BoardView.token()` draws `frame(kind, tier, side, anim, phase, cam.facing8(face, y))` with its anchor on
`cam.project(x, y, z)` at `cam.scaleAt(y) * SPRITE_VIS / ppu` screen px per atlas px. `animFor()` in units.ts picks
the animation: death while dying, attack during a swing, walk when moving, else idle. Until a sheet has loaded and
tinted, the drawn token stands in. Card portraits stay in `public/portraits`.
