// What a player's timing looks like over a match, to spot play that no hand produces. The server stamps every action
// as it arrives (clients send them as they happen), so these numbers cannot be dressed up after the fact.
// A flag is a reason to look, not a verdict: it is stored with the match and counted on the player.

export interface SeatTelemetry {
  rounds: number;
  actions: number;
  /** Median milliseconds between consecutive actions in a round. */
  medianGap: number | null;
  /** Spread of those gaps (standard deviation / mean): people are uneven, scripts are not. */
  gapSpread: number | null;
  /** Rounds with a purchase where Ready came inside 1.5 s of the round opening (before its battle could be watched). */
  instantRounds: number;
  flags: string[];
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

export function judge(gaps: number[], rounds: { actions: number; readyAfter: number | null }[]): SeatTelemetry {
  const actions = rounds.reduce((n, r) => n + r.actions, 0);
  const medianGap = gaps.length ? median(gaps) : null;
  const mean = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
  const gapSpread = gaps.length && mean > 0 ? Math.sqrt(gaps.reduce((a, g) => a + (g - mean) ** 2, 0) / gaps.length) / mean : null;
  const instantRounds = rounds.filter((r) => r.actions >= 1 && r.readyAfter !== null && r.readyAfter < 1500).length;
  const flags: string[] = [];
  if (gaps.length >= 12 && medianGap !== null && medianGap < 150) flags.push("inhuman-speed");
  if (gaps.length >= 12 && gapSpread !== null && gapSpread < 0.12) flags.push("metronome");
  if (instantRounds >= 3) flags.push("instant-rounds");
  return { rounds: rounds.length, actions, medianGap, gapSpread, instantRounds, flags };
}

/** Collects one seat's action times round by round. */
export class RoundLog {
  private gaps: number[] = [];
  private rounds: { actions: number; readyAfter: number | null }[] = [];
  private opened: number;
  private last: number | null = null;
  private count = 0;
  private readyAfter: number | null = null;
  constructor(now: number) { this.opened = now; }
  /** A round opened (its battle, if any, has just been sent). */
  begin(now: number) { this.opened = now; }
  action(now: number) {
    if (this.last !== null) this.gaps.push(now - this.last);
    this.last = now;
    this.count++;
  }
  ready(now: number) { this.readyAfter = now - this.opened; }
  endRound() {
    this.rounds.push({ actions: this.count, readyAfter: this.readyAfter });
    this.count = 0; this.last = null; this.readyAfter = null;
  }
  summary() { return judge(this.gaps, this.rounds); }
}
