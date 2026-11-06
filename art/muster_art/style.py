"""Style + atlas contract for the v3 character sprites (see docs/ART-V3-ATLAS.md).

Everything a style pick can change lives here, so swapping to the direction Jack signs off is an edit to
this file plus `npm run art`. The renderer (art/render_all.py), post (art/post.py), packer
(art/pack_atlas.py) and runtime (src/render/sprites.ts) all read their numbers from here or from the
manifest this produces, never from their own copies.
"""

# ------------------------------------------------------------------ camera (the diorama contract)
# Orthographic camera pitched EL degrees down from the horizon, looking "north" (game -y) across the board.
# A ground circle of radius r draws as an ellipse r wide and r*sin(EL) tall. The board projection must use
# the same foreshortening so a sprite's ground anchor sits on its body's position.
CAMERA_EL = 53.3  # = 90 deg - camera.ts TILT (0.64 rad), so sprites match the board
PPU = 128  # final atlas pixels per world unit (horizontal)
SS = 2  # supersample factor for raw renders

# Facings rendered. Game angles are atan2(vy, vx) with y down the screen; 0 = east (screen right), 90 = south
# (towards the camera). West-side facings are the mirror of their east-side twin, so 5 renders give 8 facings.
DIRS = [0, 45, 90, -45, -90]  # E, SE, S, NE, N
# 8-way index (angle = i*45 deg, y down) -> (rendered dir index, mirrored)
DIR8 = [(0, False), (1, False), (2, False), (1, True), (0, True), (3, True), (4, False), (3, False)]

# ------------------------------------------------------------------ animation plan
# name -> number of frames. Runtime timing lives in src/render/sprites.ts (ANIM_TIMING).
ANIMS = {"idle": 2, "walk": 4, "attack": 3, "death": 3}
# Bodies that never move reuse their idle frames for walk (manifest alias, nothing rendered).
STATIC = {"mine", "ballista", "hive", "bombard", "turret"}
# Built for the air: deaths tumble instead of toppling.
FLYING = {"harrier"}

# ------------------------------------------------------------------ look
INK = "#0b0f18"
OUTLINE = 0.011  # inverted-hull width in world units (scaled by each unit's build scale)
INK_PX = 3  # post silhouette ink at raw (SS) resolution
GLOW_PX = 7  # Ascended halo radius at raw resolution
# Toon ramp: (N.L position, brightness) stops; short soft edges keep small sprites from aliasing.
RAMP = [(0.0, 0.50), (0.30, 0.50), (0.36, 0.78), (0.70, 0.78), (0.76, 1.0), (1.0, 1.0)]
# Key light in camera space: (right, up, towards camera). Mostly top-front so mirrored facings stay plausible.
KEY = (-0.35, 0.95, 0.55)
# Rim light: comes from behind the subject, upper right; added on top of the toon colour.
RIM_DIR = (0.55, 0.7, -0.6)
RIM_COLOR = "#fff3d6"
RIM_STRENGTH = 0.55
RIM_EDGE = (0.62, 0.78)  # facing-ratio band that receives rim

# Team colour. Sprites are rendered with team materials in neutral white and a flat mask whose R, G, B channels
# carry the coverage of team main, dark and light. The runtime tints with (straight alpha, sRGB 0..1):
#   rgb = base * (1 + R*(main-1) + G*(dark-1) + B*(light-1))
# Shaded white times the team colour equals the shaded team colour (gamma-law shading commutes with the product).
TEAMS = {
    "tide": {"main": "#3fd0c9", "dark": "#167c7a", "light": "#a6fff6"},
    "ember": {"main": "#ff6a4d", "dark": "#a8331f", "light": "#ffc1ad"},
    "neutral": {"main": "#ffffff", "dark": "#ffffff", "light": "#ffffff"},
}
