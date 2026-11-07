# Arenas

One Blender-rendered battlefield per campaign act in the active style direction (Sunlit Meadow), built for the 3/4
camera (`src/render/camera.ts`), plus the props that obstacles stand up as.

| Act | Arena | Ground | Border and scenery | Obstacle prop |
|---|---|---|---|---|
| 1 | Borderlands | meadow grass with light and dark patches, sandy path | hedges, round broadleaf trees, flowers | mossy boulder |
| 2 | Ash Fields | dry gold grass | autumn hedges, orange broadleaf and dead trees, smouldering embers | charred stump with embers |
| 3 | Hollow Wood | deep green grass | hedges, broadleaf and pine wood, toadstools | mossy stump with toadstools |
| 4 | Iron Pass | highland grass, gravel strip and path | low rocks, pines and crags, pebbles | crag with an iron streak |
| 5 | High Keep | flagstone courtyard on a plinth, red runner | low stone walls, topiary in planters | stone column with a lantern (one broken, one bannered) |
| 6 | Frozen Reach | snow, packed-snow path | snow banks, snowy pines, ice shards | snow-capped rock with ice crystals |
| 7 | Sky Throne | marble courtyard over a cloud sea, blue runner | gold-finial balustrade, cloud banks | crystal obelisk on a gold and marble plinth |

Every arena keeps the same layout so the board reads the same everywhere: a sandy neutral strip between the two
deploy zones with a kerb on each zone line, a path from keep to keep, a paved plaza under each keep and a low border
just outside the board. Shapes and palettes are original and built from primitives; nothing is traced.

## How it fits the camera

- `public/arenas/act<n>.jpg` is rendered through the game's own pinhole camera (same tilt and distance as
  `camera.ts`, Blender perspective camera with matching lens and shift). The manifest's `view` is the normalised
  image-plane rectangle it covers, so the game draws it with one scale and offset (`backdropRect`) and its ground
  lines up with the board exactly on any screen size. The render script checks this with Blender's own projection
  (`camera check: max error 0.00px`). Everything in it is static and outside the play area.
- `public/arenas/act<n>_prop<0..2>.png`: obstacle props modelled with their base on the unit circle (radius 1 = the
  collision radius), rendered orthographic at the camera's mid-board elevation with a baked contact shadow. The
  board stands each on its obstacle (`propRect`) in the same depth sort as units and keeps.
- `public/arenas/act<n>_fg.webp`: the foreground, rendered alone through the same camera (same frame as the
  backdrop): canopy, boughs, banner pillars or cloud banks that overhang the board's side edges. They are in the
  backdrop too; this copy is drawn over the units (`src/render/foreground.ts`). The manifest's `fg.cells` cut it into
  bands per side (tight boxes of covered pixels); a cell fades to 28% while a unit's screen box overlaps it and eases
  back when it leaves, so units under the canopy stay readable.
- Ground dressing per act (`dress` in the render script): mown stripes, a cobbled road across the neutral strip,
  path wear and pebbles, flower/fern/heather/dry-grass clumps, tufts, moss, gravel, cracks, banners, and for the Sky
  Throne lapis-and-gold rosettes and edge bands. All of it is low so units stand over it, and it stays off the path
  and the keep plazas. Obstacles still come only from the sim and stand up as props.
- Ambient motion (`foreground.ts`, drawn under the units): water glints on the Fen's mere and cloud wisps drifting
  past the Sky Throne outside the board.
- The board lays a light team wash over each deploy zone and a glowing back line on top of the art.
- If the art is missing or was rendered for a different camera, the board falls back to its drawn terrain.

## Rendering

`npm run art:arenas` (`-- --only 1,5 --samples 16 --quick`): Eevee, about 10 s per act. Tests: `tests/arenas.test.ts`.
