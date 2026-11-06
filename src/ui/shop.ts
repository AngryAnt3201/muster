// The Full Army offer in the Meadow kit: one panel used by the Shop screen, the paywall sheet and the act-gate card.
// Price and name come from the store; Restore Purchases sits on the same panel.
import { sfx, unlockAudio } from "../audio/sfx";
import { ACTS, LEVELS, rosterAt } from "../core/campaign";
import { PUZZLES } from "../core/puzzles";
import { buzz } from "../native";
import { FREE_ACTS, FREE_PUZZLES } from "../store/entitlement";
import type { StoreController } from "../store";
import { el } from "./dom";
import { framedPortrait, ribbon } from "./game";
import { icon } from "./kit";

function button(label: string | Node, cls: string, fn: () => void) {
  const b = el("button", { class: `btn ${cls}` }, [label]) as HTMLButtonElement;
  b.addEventListener("click", () => { unlockAudio(); sfx("tap"); fn(); });
  return b;
}

/** What the Full Army opens, counted from the content so new acts and puzzles show up by themselves. */
export function fullArmyPerks(): string[] {
  const paid = LEVELS.filter((l) => l.act > FREE_ACTS);
  const lastAct = Math.max(...paid.map((l) => l.act), FREE_ACTS + 1);
  const bosses = paid.filter((l) => l.boss).length;
  const acts = lastAct > FREE_ACTS + 1 ? `Acts ${FREE_ACTS + 1}-${lastAct}` : `Act ${lastAct}`;
  const perks = [`${acts}: ${paid.length} more levels and ${bosses} bosses`, "Gauntlet: rival after rival, one health pool"];
  if (PUZZLES.length > FREE_PUZZLES) perks.push(`Breakpoint puzzles ${FREE_PUZZLES + 1}-${PUZZLES.length}`);
  return perks;
}

/** Units the campaign hands out past the free acts, for the offer's art. */
const showcaseUnits = () => {
  const free = new Set(rosterAt(Math.max(...LEVELS.filter((l) => l.act <= FREE_ACTS).map((l) => l.id))));
  return rosterAt(LEVELS.length).filter((k) => !free.has(k)).slice(0, 5);
};

export interface OfferOpts {
  /** Called once the Full Army is owned (bought or restored here). */
  onOwned?: () => void;
  /** Smaller layout for sheets. */
  compact?: boolean;
}

/** The Full Army offer: art, what it opens, the store price on the buy button, Restore Purchases, and every buy state. */
export function fullArmyOffer(store: StoreController, o: OfferOpts = {}) {
  const status = el("p", { class: "shop-status", role: "status", "aria-live": "polite" });
  const buy = button("", "gold big shop-buy", () => void doBuy());
  const restore = button("Restore Purchases", "ghost small shop-restore", () => void doRestore());
  const owned = el("div", { class: "shop-owned" }, [icon("check"), el("span", {}, ["Full Army unlocked. Thank you!"])]);
  const heroes = el("div", { class: "shop-heroes" }, showcaseUnits().map((k, i) => framedPortrait(k, i === 2 ? 4 : 3, `shop-hero h${i}`).frame));
  const panel = el("div", { class: `shop-offer ${o.compact ? "compact" : "panel"}` }, [
    ribbon("Full Army", "gold"),
    heroes,
    el("p", { class: "lead shop-pitch" }, [`Every act of the campaign, Gauntlet and all ${PUZZLES.length} Breakpoint puzzles. Pay once, keep it for good.`]),
    el("ul", { class: "shop-perks" }, fullArmyPerks().map((p) => el("li", {}, [icon("check"), el("span", {}, [p])]))),
    owned, buy, status,
    el("p", { class: "shop-fine" }, ["One-time purchase. No ads, no subscriptions, no tracking."]),
    restore,
  ]);

  let busy = false;
  const say = (text: string, tone: "" | "warn" | "good" = "") => { status.textContent = text; status.className = `shop-status ${tone}`; };
  const label = (text: string, price?: string) => buy.replaceChildren(el("span", {}, [text, ...(price ? [el("small", {}, [price])] : [])]));

  function refresh() {
    const has = store.owns();
    panel.classList.toggle("owned", has);
    buy.hidden = has;
    owned.hidden = !has;
  }
  function loadPrice() {
    if (store.owns()) return;
    buy.disabled = true;
    label("Unlock", "...");
    store.product().then((p) => {
      if (busy) return;
      if (!p) { buy.disabled = true; label("Unavailable"); say("The Full Army isn't on sale right now.", "warn"); return; }
      buy.disabled = false;
      buy.dataset.ready = "1";
      label("Unlock", p.displayPrice);
    }, () => {
      if (busy) return;
      buy.disabled = false;
      delete buy.dataset.ready;
      label("Try again");
      say("Can't reach the App Store right now.", "warn");
    });
  }
  async function doBuy() {
    if (busy) return;
    if (!buy.dataset.ready) { say(""); loadPrice(); return; }
    busy = true; buy.disabled = true; restore.disabled = true;
    label("Buying...");
    say("");
    const r = await store.buy();
    busy = false; restore.disabled = false;
    if (r.status === "purchased") { done("Welcome to the Full Army."); return; }
    buy.disabled = false;
    loadPrice();
    if (r.status === "pending") say("Waiting for approval. It opens by itself once it goes through.");
    else if (r.status === "cancelled") say("");
    else { sfx("deny"); say(r.message ? `The purchase didn't go through. ${r.message}` : "The purchase didn't go through.", "warn"); }
  }
  async function doRestore() {
    if (busy) return;
    busy = true; buy.disabled = true; restore.disabled = true;
    say("Restoring...");
    try {
      const has = await store.restore();
      busy = false; restore.disabled = false;
      if (has) { done("Restored. Everything is open."); return; }
      say("No Full Army purchase found for this Apple ID.");
    } catch {
      busy = false; restore.disabled = false;
      say("Can't reach the App Store right now.", "warn");
    }
    buy.disabled = false;
    loadPrice();
  }
  function done(text: string) {
    sfx("upgrade"); buzz("success");
    refresh();
    say(text, "good");
    o.onOwned?.();
  }

  refresh();
  loadPrice();
  // An Ask to Buy approval (or a refund) can land while the panel is open.
  const off = store.onChange(() => { if (!panel.isConnected) { off(); return; } refresh(); if (store.owns()) { say("Approved. Everything is open.", "good"); o.onOwned?.(); } else loadPrice(); });
  return panel;
}

/** The card on a locked act's map page: what's past Act 2 and the way in. */
export function actGateCard(act: number, store: StoreController, open: () => void) {
  const price = el("small", {}, ["..."]);
  const go = button(el("span", {}, ["Unlock Full Army", price]), "gold big act-gate-buy", open);
  store.product().then((p) => { price.textContent = p?.displayPrice ?? ""; price.hidden = !p; }, () => { price.hidden = true; });
  const paid = LEVELS.filter((l) => l.act > FREE_ACTS);
  return el("div", { class: "act-gate panel" }, [
    el("span", { class: "act-gate-crest" }, [icon("crown")]),
    el("b", { class: "act-gate-title" }, [`Act ${act} is part of the Full Army`]),
    el("p", { class: "act-gate-text" }, [`${ACTS.length - FREE_ACTS} more acts, ${paid.length} levels, Gauntlet and every puzzle. One purchase, yours for good.`]),
    go,
  ]);
}
