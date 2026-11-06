# Arenas

One Blender-rendered battlefield per campaign act, and the props that obstacles draw as.

| Act | Arena | Ground and paths | Edge props | Obstacle prop |
|---|---|---|---|---|
| 1 | Borderlands | meadow grass, a winding dirt road | round trees, berry bushes, hay bales, fences | mossy boulder |
| 2 | Ash Fields | ash with glowing ember cracks, a cinder road and two side tracks | dead trees, smouldering stumps, braziers | charred stump with embers |
| 3 | Hollow Wood | moss and leaf litter, a forked forest trail | dark-canopy trees, bushes, toadstools | hollow stump with moss and toadstools |
| 4 | Iron Pass | grey gravel, a wide packed-earth pass | crag boulders, mountain pines | split crag with an iron streak |
| 5 | High Keep | flagstone courtyard with mossy joints, a red runner with gold trim and a cross walk | crenellated walls, team banners, barrels, braziers | stone column (one variant broken, one with a hanging banner) |
| 6 | Frozen Reach | snow with blue ice sheets and sparkle, a trampled drift path | snow-capped pines, snow mounds, ice crystals | ice crystal cluster on a snowy rock |
| 7 | Sky Throne | marble platform with gold grout over open sky and cloud tops, a blue runner | marble balusters with gold finials, clouds, braziers | blue crystal obelisk on a gold and marble plinth |

Each act also gets a rim of low props (bushes, rocks, embers, mushrooms, kerb stones, snow, clouds) hugging both long
board edges, half on and half off the board: on a phone the board fills the screen width, so the wider edge
clutter is mostly off screen and the rim is what frames the field. They're flat enough not to hide units.

All shapes and palettes are original and built from primitives in `art/arenas/render_arenas.py`; nothing is traced
from another game.

## Files

- `public/arenas/act<n>.jpg`: the backdrop (ground texture, paths, edge props, baked sun, sky fill and shadows).
- `public/arenas/act<n>_prop<0..2>.png`: three obstacle prop variants with their own baked contact shadow.
- `public/arenas/manifest.json`: camera, world rectangle, prop frame and measured prop footprints.
- `npm run art:arenas` (`-- --only 2,5 --samples 48 --elev 60`) re-renders. Cycles on Metal; the first run
  compiles kernels for a few minutes.
- `npx vite-node tools/arena-preview.ts` rebuilds the review page `outputs/signoff/arenas/index.html` (every act with
  real level obstacles, sample units passing the props, and a collision-circle overlay).

## Camera contract

- Orthographic, looking north from the player's side at `elev` degrees above the ground (60 today).
- The backdrop covers board rectangle `world` (x -4..13, y -6..20: the board is 9 x 14) at `ppu` px per board unit
  across. A board point `(x, y)` on the ground is at image px `((x - world.x) * ppu, (y - world.y) * ppu * sin(elev))`.
- On today's flat board the backdrop is drawn into the world rectangle (so it is stretched by `1 / sin(elev)`
  vertically): the ground lines up exactly with the sim and upright things lean up the screen. A camera tilted to the
  same `elev` draws it unstretched (pass `stretch = 1` to `propRect`).
- Keep pads: the ground leaves a paved plaza clear at (4.5, -1.7) and (4.5, 15.7) for the commanders' keeps.

## Obstacle props

- Each prop is modelled so its silhouette from straight above is exactly the unit circle around its footprint
  centre, then drawn at the obstacle's radius `r`. The render measures the silhouette width back from the image
  alpha (`footprint`, in prop radii, outline included) and `tests/arenas.test.ts` holds it within 8 % of 1.
- The sprite's footprint centre is at `anchor` (fractions of the frame from the top left); the frame is `propFrame`
  prop radii wide.
- A variant is picked from the obstacle's position, so it stays the same between rounds.
- Depth: props are painted into the backdrop, then the half above each footprint centre is repainted in the body
  draw order (`BoardView.propPainter`), so bodies behind a prop are hidden by it and bodies in front stay on top.
  Flyers draw over everything.

## Choosing an arena

`GameOpts.arena` is the level's act (campaign only). `arenaAct` falls back to act 1 for anything without an
arena (skirmish, gauntlet, puzzles, the title demo, or an act number the art doesn't have yet). If the manifest or an
image is missing the board keeps painting its drawn terrain.
