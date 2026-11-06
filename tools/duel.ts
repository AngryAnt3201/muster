import { Match } from "../src/core/match";
import { planTurn, applyPlan, DEFAULT_AI, type AIProfile } from "../src/core/ai";
export function play(seed: number, a: AIProfile, b: AIProfile) {
  const m = new Match({ seed });
  while (m.phase !== "over" && m.round < 40) {
    applyPlan(m, 0, planTurn(m, 0, a));
    applyPlan(m, 1, planTurn(m, 1, b));
    m.fight();
    m.next();
  }
  return m;
}
export function series(a: AIProfile, b: AIProfile, n: number, seed0 = 1) {
  let w = 0, l = 0, rounds = 0;
  for (let s = 0; s < n; s++) {
    // Alternate seats so neither side has an edge.
    const flip = s % 2 === 1;
    const m = flip ? play(seed0 + s, b, a) : play(seed0 + s, a, b);
    if (flip ? m.winner === 1 : m.winner === 0) w++;
    if (flip ? m.winner === 0 : m.winner === 1) l++;
    rounds += m.round;
  }
  return { w, l, n, avgRounds: +(rounds / n).toFixed(1) };
}
if (process.env.DUEL) {
  const d = (x: number, extra: Partial<AIProfile> = {}): AIProfile => ({ ...DEFAULT_AI, difficulty: x, ...extra });
  console.log("0.9 vs 0.15", series(d(0.9), d(0.15), 16));
  console.log("0.9 vs 0.5", series(d(0.9), d(0.5), 16));
  console.log("0.5 vs 0.15", series(d(0.5), d(0.15), 16));
}
