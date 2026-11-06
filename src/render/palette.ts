import type { Side } from "../core/defs";

export const INK = "#0a0e16";
export const BOARD = { base0: "#16202e", base1: "#0f1722", line: "rgba(160,190,220,0.055)", band: "rgba(0,0,0,0.22)" };

/** Team colours: the player is Tide (cyan), the rival is Ember (coral). */
export const TEAM = [
  { main: "#3fd0c9", dark: "#167c7a", light: "#a6fff6", glow: "rgba(63,208,201,", zone: "rgba(63,208,201,0.07)" },
  { main: "#ff6a4d", dark: "#a8331f", light: "#ffc1ad", glow: "rgba(255,106,77,", zone: "rgba(255,106,77,0.06)" },
] as const;

export const team = (s: Side) => TEAM[s];
export const STEEL = "#e8eef5";
export const WOOD = "#8a5a35";
export const GOLD = "#ffd166";
export const HEAL = "#7dffa6";
export const ZAP = "#cfe8ff";
export const VIOLET = "#b48cff";
