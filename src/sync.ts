// Economy actions. Every way a player's coins, gems, cards, chests, levels or progress can change is one named action:
// `op(name, fn, check)`. Offline it is just the function. Online it runs twice: here at once, so the screen does not
// wait, and on the server (server/solo.ts) against the account it holds, which is the one that counts. The server
// then sends its copy back and the device takes it as it is (src/net/solo.ts). `check` is the server's guard: it turns
// whatever a client sent into arguments the rules can trust, or throws. Nothing without a name here reaches the server:
// the low-level pieces (earn, spend, grant) are not actions and cannot be called from outside.

type Fn = (...a: any[]) => any;
interface Op { run: Fn; check: (raw: unknown[]) => unknown[]; server?: Fn; result: boolean; gap: number; }
const OPS = new Map<string, Op>();
let depth = 0;
let sink: ((name: string, args: unknown[]) => void) | null = null;

/** Online: where top-level actions are reported (src/net/solo.ts sends them to the server in order). */
export const setOpSink = (f: typeof sink) => { sink = f; };

export interface OpOptions<A extends unknown[]> {
  /** What the server runs instead (e.g. open a chest and pay it out in one step, where the device animates between). */
  server?: (...a: A) => unknown;
  /** A battle result: the server spaces these out (`gap` seconds since the last one) since it cannot watch the fight. */
  result?: boolean;
  gap?: number;
}

export function op<A extends unknown[], R>(name: string, run: (...a: A) => R, check: (raw: unknown[]) => A, o: OpOptions<A> = {}): (...a: A) => R {
  OPS.set(name, { run, check, server: o.server as Fn | undefined, result: !!o.result, gap: o.gap ?? 0 });
  return (...args: A): R => {
    depth++;
    try { return run(...args); } finally {
      depth--;
      if (depth === 0 && sink) sink(name, args);
    }
  };
}
export const opInfo = (name: string) => OPS.get(name);
/** Server: run a client's action on the current save (see withSave), after its guard. Throws if it is not allowed. */
export function runOp(name: string, raw: unknown) {
  const o = OPS.get(name);
  if (!o) throw Error("Unknown action");
  const args = o.check(Array.isArray(raw) ? raw : []);
  return (o.server ?? o.run)(...args);
}

// ---- guards
export class Refused extends Error {}
const no = (why: string): never => { throw new Refused(why); };
export const none = (): [] => [];
export const int = (v: unknown, lo: number, hi: number): number => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : no("Bad number"));
export const bool = (v: unknown): boolean => v === true;
export const oneOf = <T extends string>(v: unknown, list: readonly T[]): T => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : no("Bad choice"));

// ---- the clock and the dice: the device's own offline; online both come from the server
let wall: () => Date = () => new Date();
/** "Now" as a Date whose local fields are the player's wall clock (day keys: daily deals, quests, caps). */
export const wallNow = () => wall();
export const setWallClock = (f: () => Date) => { wall = f; };
let dice: () => number = () => (Math.random() * 2 ** 32) >>> 0;
/** A seed for something rolled (a chest's contents). */
export const nextSeed = () => dice();
export const setSeedSource = (f: () => number) => { dice = f; };
