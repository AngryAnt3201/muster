// The device's side of the server-held account. Signed in, the save every screen reads is a mirror of the server's:
// an economy action (src/sync.ts) runs here at once and is sent to the server, which runs it again on the real
// account and answers with that account; the device then takes the server's copy as it is. Whatever the device did
// that the server would not (not enough gems, a result too soon, a tampered client) simply is not there afterwards.
import { adoptSave, load } from "../save";
import { setOpSink, setSeedSource } from "../sync";
import type { NetClient } from "./client";
import type { SoloReply, SoloState } from "./protocol";

let seeds: number[] = [];
let queue: { name: string; args: unknown[] }[] = [];
let sending = false;
let settleT = 0;
let onChange: (() => void) | null = null;
export let soloOnline = false;

const tz = () => new Date().getTimezoneOffset();
/** What a player would notice changing: used to decide whether a screen needs redrawing after the server answers. */
function shape(): string {
  const s = load() as unknown as Record<string, any>;
  return JSON.stringify([s.wallet?.coins, s.wallet?.gems, s.collection, s.progression?.levels, s.progression?.xp, s.progression?.deck, s.campaign, s.puzzles,
    s.chests?.slots?.map((c: any) => c && [c.type, c.readyAt !== undefined]), s.cosmetics, s.pass?.xp, s.pass?.free, s.pass?.prem, s.pass?.premium, s.pass?.toOpen?.length, s.quests?.claimed, s.store, s.offers]);
}
function take(st: SoloState, quiet = false) {
  seeds = [...st.seeds];
  const before = quiet ? "" : shape();
  adoptSave(st.save as never);
  if (!quiet && shape() !== before) onChange?.();
}

async function flush(n: NetClient) {
  if (sending) return;
  sending = true;
  clearTimeout(settleT);
  try {
    while (queue.length) {
      const batch = queue.slice(0, 20);
      let r: SoloReply;
      try { r = await n.call<SoloReply>("POST", "/v1/solo/ops", { ops: batch, tz: tz() }); } catch { break; } // offline: kept, retried on the next action
      queue = queue.slice(batch.length);
      // Only when nothing newer is waiting: otherwise the server's copy would be missing what was just done here.
      if (!queue.length) take(r);
    }
  } finally { sending = false; }
  // A moment after things go quiet, check the mirror once more (a chest paid here in the same breath it was opened).
  if (!queue.length) settleT = window.setTimeout(() => void refreshSolo(n), 1500);
}

/** Fetches the account again (after paying on Stripe, on coming back to the tab). */
export async function refreshSolo(n: NetClient) {
  if (!soloOnline || sending || queue.length) return;
  try { const st = await n.call<SoloState>("GET", `/v1/solo?tz=${tz()}`); if (!sending && !queue.length) take(st); } catch { /* next time */ }
}

/** Signed in: the server's account becomes this device's save, and every action from here on is reported.
 *  `changed` is called when the server's answer differs from what the screen shows. */
export async function startSolo(n: NetClient, changed: () => void): Promise<boolean> {
  const st = await n.call<SoloState>("GET", `/v1/solo?tz=${tz()}`);
  take(st, true);
  onChange = changed;
  soloOnline = true;
  setSeedSource(() => seeds.shift() ?? ((Math.random() * 2 ** 32) >>> 0));
  setOpSink((name, args) => { queue.push({ name, args }); void flush(n); });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void refreshSolo(n); });
  return true;
}
