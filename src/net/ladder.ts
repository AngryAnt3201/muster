// The ranked ladder: trophies, leagues and where scripted players sit. Shared by the server (which keeps score) and
// the game (which shows it). Pure numbers, no storage.

export interface League { id: number; name: string; floor: number; }
/** Leagues by the trophies that open them. Reaching one is permanent: a loss never drops you below its floor. */
export const LEAGUES: League[] = ([
  ["Mustering Field", 0], ["Palisade", 300], ["Stone Gate", 600], ["Bastion", 1000],
  ["Citadel", 1400], ["High Keep", 1800], ["Crown Court", 2200], ["Warlords", 2600],
] as [string, number][]).map(([name, floor], id) => ({ id, name, floor }));

export const leagueOf = (trophies: number): League => [...LEAGUES].reverse().find((l) => trophies >= l.floor) ?? LEAGUES[0];

/** Scripted players (house bots, bot tokens, accounts the automation checks keep flagging) live in the first two
 *  leagues: they can never hold more trophies than this, so everything from Stone Gate up is people. */
export const SCRIPTED_CAP = LEAGUES[2].floor - 1;
/** Flagged matches after which an account counts as scripted until someone clears it. */
export const SCRIPTED_FLAGS = 3;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** How much of a loss counts, by league: the first leagues are gentle. */
const LOSS_SCALE = [0.3, 0.6];

/** Trophies a result moves (signed). Beating someone above you pays more; losing to someone below you costs more. */
export function trophyChange(mine: number, theirs: number, won: boolean): number {
  const swing = clamp(Math.round((theirs - mine) / 12), -10, 10);
  if (won) return 30 + swing;
  return -Math.round((30 - swing) * (LOSS_SCALE[leagueOf(mine).id] ?? 1));
}

/** Applies a change: never below the floor of the best league reached, never above the cap for a scripted player. */
export function applyTrophies(current: number, peak: number, delta: number, scripted: boolean): { trophies: number; peak: number } {
  let t = current + delta;
  if (delta < 0) t = Math.max(t, Math.min(current, leagueOf(peak).floor));
  if (scripted) t = Math.min(t, SCRIPTED_CAP);
  t = Math.max(0, t);
  return { trophies: t, peak: Math.max(peak, t) };
}
