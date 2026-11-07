// The Shop screen: Full Army at the top (cash only), then gem packs (App Store consumables), then coin bundles
// bought with gems. Plus the two small gem moments elsewhere: the free-gem strip on result screens and the
// Gauntlet Rally. Prices are always StoreKit's displayPrice; gem amounts come from src/economy/gems.ts.
import { sfx, unlockAudio } from "../audio/sfx";
import {
  COIN_BUNDLES, GEM_NAME, GEM_PACKS, RALLY_GEMS, applyRally, bestValue, canRally, coinBonus, packBonus, type RallyRun, type Reward,
} from "../economy/gems";
import { canAfford, earn, spend } from "../economy/wallet";
import { buzz } from "../native";
import type { StoreController } from "../store";
import type { GemShop } from "../store/gems";
import type { Product } from "../store/types";
import { currencyBar, flyInto, gemIcon, coinIcon, rewardStrip } from "./currency";
import { el } from "./dom";
import { ribbon } from "./game";
import { fullArmyOffer } from "./shop";

const fmt = (n: number) => n.toLocaleString("en");
function button(label: string | Node, cls: string, fn: () => void) {
  const b = el("button", { class: `btn ${cls}` }, [label]) as HTMLButtonElement;
  b.addEventListener("click", () => { unlockAudio(); sfx("tap"); fn(); });
  return b;
}

/** Bigger packs show a bigger pile. */
const pile = (i: number) => el("span", { class: `gem-pile p${i}` }, Array.from({ length: Math.min(5, i + 1) }, (_, k) => gemIcon(`g${k}`)));

/** Everything under the Shop header. */
export function shopView(store: StoreController, gems: GemShop) {
  const bar = currencyBar("shop-cur");
  const gemPill = bar.querySelector<HTMLElement>(".cur-gems")!;
  const coinPill = bar.querySelector<HTMLElement>(".cur-coins")!;
  const status = el("p", { class: "gem-status", role: "status", "aria-live": "polite" });
  const say = (text: string, tone: "" | "warn" | "good" = "") => { status.textContent = text; status.className = `gem-status ${tone}`; };
  let busy = false;

  // ---- gem packs
  const grid = el("div", { class: "gem-grid" });
  const cards = new Map<string, { card: HTMLElement; buy: HTMLButtonElement; bonus: HTMLElement }>();
  GEM_PACKS.forEach((p, i) => {
    const buy = button(el("span", {}, ["..."]), "gold gem-buy", () => void doBuy(p.id));
    buy.disabled = true;
    const bonus = el("span", { class: "gem-bonus" });
    const card = el("div", { class: "gem-card", "data-pack": p.id }, [
      pile(i),
      el("b", { class: "gem-amount" }, [fmt(p.gems)]),
      el("span", { class: "gem-name" }, [p.name]),
      bonus,
      buy,
    ]);
    cards.set(p.id, { card, buy, bonus });
    grid.append(card);
  });

  function show(ps: Product[]) {
    const prices = Object.fromEntries(ps.map((p) => [p.id, p.price]));
    const bonus = packBonus(prices), best = bestValue(prices);
    for (const [id, c] of cards) {
      const p = ps.find((x) => x.id === id);
      c.card.classList.toggle("best", id === best && !!p);
      c.card.querySelector(".gem-flag")?.remove();
      if (id === best && p) c.card.prepend(el("span", { class: "gem-flag" }, ["Best value"]));
      c.bonus.textContent = bonus[id] ? `+${bonus[id]}% more` : "";
      c.buy.disabled = !p || busy;
      c.buy.dataset.ready = p ? "1" : "";
      c.buy.replaceChildren(el("span", {}, [p ? p.displayPrice : "Unavailable"]));
    }
  }
  function load() {
    for (const c of cards.values()) { c.buy.disabled = true; c.buy.replaceChildren(el("span", {}, ["..."])); }
    gems.packs().then((ps) => { if (!busy) { show(ps); if (!ps.length) say(`${GEM_NAME} aren't on sale right now.`, "warn"); } }, () => {
      for (const c of cards.values()) { c.buy.disabled = false; c.buy.dataset.ready = ""; c.buy.replaceChildren(el("span", {}, ["Retry"])); }
      say("Can't reach the App Store right now.", "warn");
    });
  }
  async function doBuy(id: string) {
    const c = cards.get(id)!;
    if (busy) return;
    if (!c.buy.dataset.ready) { say(""); load(); return; }
    busy = true;
    for (const x of cards.values()) x.buy.disabled = true;
    c.buy.replaceChildren(el("span", {}, ["Buying..."]));
    say("");
    const r = await gems.buy(id);
    busy = false;
    load();
    if (r.status === "purchased") {
      const n = GEM_PACKS.find((p) => p.id === id)!.gems;
      say(`+${fmt(n)} ${GEM_NAME}. Thank you!`, "good");
      buzz("success");
      c.card.classList.remove("gem-pop"); void c.card.offsetWidth; c.card.classList.add("gem-pop");
      void flyInto(c.card.querySelector(".gem-pile")!, gemPill, "gems", n);
      refreshCoins();
    } else if (r.status === "pending") say(`Waiting for approval. The ${GEM_NAME.toLowerCase()} arrive by themselves once it goes through.`);
    else if (r.status === "cancelled") say("");
    else { sfx("deny"); say(r.message ? `The purchase didn't go through. ${r.message}` : "The purchase didn't go through.", "warn"); }
  }

  // Gems that land outside a buy (Ask to Buy approved, an interrupted purchase finishing) fly in too.
  const offCredit = gems.onCredit((cr) => {
    if (!grid.isConnected) { offCredit(); return; }
    say(`+${fmt(cr.gems)} ${GEM_NAME} arrived. Thank you!`, "good");
    const card = cards.get(cr.productId)?.card ?? grid;
    void flyInto(card, gemPill, "gems", cr.gems);
    refreshCoins();
  });

  // ---- coin bundles (gems -> coins)
  const coinRows = COIN_BUNDLES.map((b) => {
    const go = button(el("span", {}, [gemIcon(), fmt(b.gems)]), "coin-buy", () => {
      if (!spend("gems", b.gems, `coins:${b.id}`)) { sfx("deny"); say(`Not enough ${GEM_NAME.toLowerCase()} for that bundle.`, "warn"); return; }
      earn("coins", b.coins, `bundle:${b.id}`);
      buzz("light");
      say(`+${fmt(b.coins)} coins.`, "good");
      void flyInto(row, coinPill, "coins", b.coins);
      refreshCoins();
    });
    const row = el("div", { class: "coin-row", "data-bundle": b.id }, [
      el("span", { class: "coin-pile" }, [coinIcon(), coinIcon(), ...(b.gems >= 100 ? [coinIcon()] : [])]),
      el("span", { class: "coin-what" }, [el("b", {}, [`${fmt(b.coins)} coins`]), el("small", {}, [coinBonus(b) > 0 ? `+${coinBonus(b)}% bulk bonus` : "For troop upgrades"])]),
      go,
    ]);
    return { row, go, b };
  });
  function refreshCoins() { for (const c of coinRows) c.go.classList.toggle("short", !canAfford("gems", c.b.gems)); }
  refreshCoins();

  load();
  return el("div", { class: "gem-shop" }, [
    bar,
    fullArmyOffer(store),
    el("section", { class: "gem-section panel" }, [
      ribbon(GEM_NAME, "gem-ribbon"),
      el("p", { class: "gem-lead" }, [`Spend ${GEM_NAME.toLowerCase()} on coins for troop upgrades or a Gauntlet Rally. Every Daily win, boss and three-star clear earns them free.`]),
      grid,
      status,
    ]),
    el("section", { class: "gem-section panel coins" }, [
      ribbon("Coins", "gold small"),
      ...coinRows.map((c) => c.row),
    ]),
    el("p", { class: "gem-fine" }, [
      `${GEM_NAME} are used up when spent, so Restore Purchases can't bring them back: it restores the Full Army only. `,
      "Every pack lists exactly what you get. No ads, no tracking, no random rewards.",
    ]),
  ]);
}

/** Appends the free gems a result screen just paid into its sheet (a marked hook in src/main.ts calls this). */
export function showRewards(host: HTMLElement | null, rewards: Reward[]) {
  const strip = rewardStrip(rewards);
  const box = host?.querySelector(".results");
  if (!strip || !box) return;
  const before = box.querySelector(".result-stats");
  box.insertBefore(strip, before?.nextSibling ?? null);
}

/** The Gauntlet Rally on a lost run's result sheet: refight the same rival at half health, once per run, for gems. */
export function rallyOffer(host: HTMLElement | null, run: RallyRun & { stage: number }, onRally: () => void) {
  const box = host?.querySelector(".results");
  if (!box || !canRally(run)) return;
  const afford = canAfford("gems", RALLY_GEMS);
  const go = button(el("span", {}, ["Rally", el("small", {}, [gemIcon(), String(RALLY_GEMS)])]), `gem big rally-btn ${afford ? "" : "short"}`, () => {
    if (!spend("gems", RALLY_GEMS, "gauntlet:rally")) { sfx("deny"); note.textContent = `You need ${RALLY_GEMS} ${GEM_NAME.toLowerCase()}. Daily wins and bosses earn them.`; return; }
    applyRally(run);
    buzz("success");
    onRally();
  });
  const note = el("small", { class: "rally-note" }, [`Refight rival ${run.stage} at half health. Once per run.`]);
  const first = box.querySelector(".btn");
  box.insertBefore(el("div", { class: "rally" }, [go, note]), first);
}
