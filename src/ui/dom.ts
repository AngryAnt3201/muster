export function el(tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) e.append(c);
  return e;
}

export const fmt = (n: number) => (Math.abs(n - Math.round(n)) < 0.05 ? String(Math.round(n)) : n.toFixed(1));

export function stars(n: number, of = 3) {
  return el("span", { class: "stars" }, Array.from({ length: of }, (_, i) => el("i", { class: i < n ? "on" : "" }, ["★"])));
}
