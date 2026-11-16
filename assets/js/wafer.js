/* Taiwan-Stocks — 晶圓圖：每個追蹤項目是一顆晶粒，顏色代表當日漲跌。
   加權指數放在晶圓中心，其餘依 indices.json 順序由內往外排列。 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const SIZE = 600, C = SIZE / 2, R = 280;
  const DIE_W = 90, DIE_H = 64, LIMIT = 268;

  function node(name, attrs, parent) {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  /** 算出晶圓上的所有晶粒：完整落在晶圓內的可放項目（依離中心距離排序），邊緣不完整的只當裝飾 */
  function diePositions() {
    const full = [], edge = [];
    for (let i = -6; i <= 6; i++) {
      for (let j = -6; j <= 6; j++) {
        const x0 = i * DIE_W - DIE_W / 2, y0 = j * DIE_H - DIE_H / 2;
        const corners = [[x0, y0], [x0 + DIE_W, y0], [x0, y0 + DIE_H], [x0 + DIE_W, y0 + DIE_H]];
        const inside = corners.filter(([x, y]) => Math.hypot(x, y) <= LIMIT).length;
        const cx = x0 + DIE_W / 2, cy = y0 + DIE_H / 2;
        const pos = { x: C + x0, y: C + y0, d: Math.round(Math.hypot(cx, cy * 1.15)), a: Math.atan2(cy, cx) };
        if (inside === 4) full.push(pos);
        else if (inside > 0 || Math.hypot(cx, cy) < R) edge.push({ ...pos, edge: true });
      }
    }
    full.sort((p, q) => p.d - q.d || p.a - q.a);
    return full.concat(edge);
  }

  /**
   * @param {HTMLElement} box
   * @param {Array} items [{ slug, label, short, pct, close }]
   */
  function renderWafer(box, items) {
    box.innerHTML = "";
    const svg = node("svg", { class: "wafer", viewBox: `0 0 ${SIZE} ${SIZE + 10}`, role: "group", "aria-label": "各項目當日漲跌晶圓圖" }, box);
    const defs = node("defs", {}, svg);
    const clip = node("clipPath", { id: "wafer-clip" }, defs);
    node("circle", { cx: C, cy: C, r: R - 4 }, clip);
    node("circle", { class: "disc", cx: C, cy: C, r: R }, svg);
    const layer = node("g", { "clip-path": "url(#wafer-clip)" }, svg);
    // 晶圓缺口（notch）
    node("path", { d: `M${C - 9},${C + R + 1} A9,9 0 0 1 ${C + 9},${C + R + 1}`, fill: "#F5F7F9", stroke: "#C5CFDA", "stroke-width": 1.5 }, svg);

    const tip = document.createElement("div");
    tip.className = "wafer-tip";
    box.appendChild(tip);

    const slots = diePositions();
    const dies = [];
    slots.forEach((pos, k) => {
      const it = items[k];
      if (!it) {
        const g = node("g", { class: "die blank" }, layer);
        node("rect", { x: pos.x, y: pos.y, width: DIE_W, height: DIE_H }, g);
        dies.push({ g, pos });
        return;
      }
      const color = TS.heat(it.pct);
      const g = node("a", { class: "die", href: `index-page.html?id=${it.slug}`, "aria-label": `${it.short} ${TS.pct(it.pct)}` }, layer);
      node("rect", { x: pos.x, y: pos.y, width: DIE_W, height: DIE_H, fill: color.fill }, g);
      node("text", { x: pos.x + DIE_W / 2, y: pos.y + 27, fill: color.ink }, g).textContent = it.label;
      node("text", { class: "pct", x: pos.x + DIE_W / 2, y: pos.y + 47, fill: color.ink }, g).textContent = TS.pct(it.pct);

      const show = () => {
        const rect = box.getBoundingClientRect(), r = g.getBoundingClientRect();
        tip.innerHTML = `${TS.esc(it.short)}<br><b>${TS.fmt(it.close)}</b>　<b>${TS.pct(it.pct)}</b>`;
        tip.style.left = `${r.left - rect.left + r.width / 2}px`;
        tip.style.top = `${r.top - rect.top}px`;
        tip.style.display = "block";
      };
      g.addEventListener("mouseenter", show);
      g.addEventListener("focus", show);
      g.addEventListener("mouseleave", () => { tip.style.display = "none"; });
      g.addEventListener("blur", () => { tip.style.display = "none"; });
      dies.push({ g, pos });
    });

    // 載入時的一次掃描：像檢測機台由上往下掃過晶圓
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const scan = node("line", { class: "scan", x1: C - R, x2: C + R, y1: C - R, y2: C - R }, svg);
    dies.forEach(({ g }) => { g.style.opacity = "0.15"; });
    const start = performance.now(), dur = 1100;
    const step = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const yLine = C - R + t * 2 * R;
      scan.setAttribute("y1", yLine); scan.setAttribute("y2", yLine);
      scan.style.opacity = t < 1 ? "0.9" : "0";
      dies.forEach(({ g, pos }) => { if (pos.y <= yLine) g.style.opacity = "1"; });
      if (t < 1) requestAnimationFrame(step);
      else dies.forEach(({ g }) => { g.style.opacity = "1"; });
    };
    requestAnimationFrame(step);
  }

  TS.renderWafer = renderWafer;
})();
