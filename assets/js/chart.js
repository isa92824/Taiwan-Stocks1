/* Taiwan-Stocks — 自製 SVG 走勢圖（不使用外部圖表套件，CLAUDE.md 第 3 節） */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const PAD = { top: 14, right: 14, bottom: 28, left: 62 };

  function node(name, attrs, parent) {
    const el = document.createElementNS(NS, name);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (parent) parent.appendChild(el);
    return el;
  }

  function ticks(min, max, count = 4) {
    const span = max - min || Math.abs(max) || 1;
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) || mag * 10;
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(8));
    return out;
  }

  /**
   * @param {HTMLElement} box 固定高度的容器
   * @param {Array} points [["YYYY-MM-DD", value], ...]
   * @param {Object} opt { color, digits }
   */
  function lineChart(box, points, opt = {}) {
    const color = opt.color || "#3A3FD9";
    const digits = opt.digits ?? 2;

    const draw = () => {
      box.innerHTML = "";
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      if (points.length < 2) {
        box.innerHTML = '<p class="empty">資料不足兩個交易日，暫時無法畫出走勢。</p>';
        return;
      }
      const values = points.map((p) => p[1]);
      let min = Math.min(...values), max = Math.max(...values);
      const pad = (max - min) * 0.08 || max * 0.01 || 1;
      min -= pad; max += pad;
      const iw = W - PAD.left - PAD.right, ih = H - PAD.top - PAD.bottom;
      const x = (i) => PAD.left + (i / (points.length - 1)) * iw;
      const y = (v) => PAD.top + (1 - (v - min) / (max - min)) * ih;

      const svg = node("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": opt.label || "走勢圖" }, box);

      ticks(min, max).forEach((t) => {
        node("line", { class: "gridline", x1: PAD.left, x2: W - PAD.right, y1: y(t), y2: y(t) }, svg);
        node("text", { class: "axis", x: PAD.left - 10, y: y(t) + 4, "text-anchor": "end" }, svg).textContent =
          t.toLocaleString("zh-TW", { maximumFractionDigits: t < 100 ? 2 : 0 });
      });

      const every = Math.max(1, Math.ceil(points.length / 6));
      points.forEach((p, i) => {
        if (i % every && i !== points.length - 1) return;
        node("text", { class: "axis", x: x(i), y: H - 8, "text-anchor": "middle" }, svg).textContent = p[0].slice(5).replace("-", "/");
      });

      const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
      node("path", { d: `${d}L${x(points.length - 1)},${PAD.top + ih}L${x(0)},${PAD.top + ih}Z`, fill: color, "fill-opacity": 0.07 }, svg);
      node("path", { d, fill: "none", stroke: color, "stroke-width": 2.2, "stroke-linejoin": "round" }, svg);
      if (points.length <= 40) {
        points.forEach((p, i) => node("rect", { x: x(i) - 3, y: y(p[1]) - 3, width: 6, height: 6, fill: "#fff", stroke: color, "stroke-width": 1.6 }, svg));
      }

      const cursor = node("line", { x1: 0, x2: 0, y1: PAD.top, y2: PAD.top + ih, stroke: "#F2B705", "stroke-width": 1.5, visibility: "hidden" }, svg);
      const tip = document.createElement("div");
      tip.className = "chart-tip";
      box.appendChild(tip);
      const hit = node("rect", { x: PAD.left, y: PAD.top, width: iw, height: ih, fill: "transparent" }, svg);
      const move = (evt) => {
        const rect = svg.getBoundingClientRect();
        const px = (evt.touches ? evt.touches[0].clientX : evt.clientX) - rect.left;
        const i = Math.max(0, Math.min(points.length - 1, Math.round(((px - PAD.left) / iw) * (points.length - 1))));
        cursor.setAttribute("x1", x(i)); cursor.setAttribute("x2", x(i)); cursor.setAttribute("visibility", "visible");
        const p = points[i];
        const dayPct = p[2];
        tip.innerHTML = `${p[0]}<br><b>${TS.fmt(p[1], digits)}</b> <span class="${TS.trend(dayPct)}" style="color:inherit">${TS.pct(dayPct)}</span>`;
        tip.style.display = "block";
        tip.style.left = `${Math.max(60, Math.min(W - 60, x(i)))}px`;
        tip.style.top = `${y(p[1])}px`;
      };
      const leave = () => { cursor.setAttribute("visibility", "hidden"); tip.style.display = "none"; };
      hit.addEventListener("mousemove", move);
      hit.addEventListener("touchmove", move, { passive: true });
      hit.addEventListener("mouseleave", leave);
      hit.addEventListener("touchend", leave);
    };

    box._draw = draw;
    draw();
    if (!box._ro) {
      box._ro = new ResizeObserver(() => box._draw && box._draw());
      box._ro.observe(box);
    }
  }

  /** 小型走勢線（總覽表格用） */
  function sparkline(el, values, color) {
    if (values.length < 2) { el.innerHTML = ""; return; }
    const W = 120, H = 28, min = Math.min(...values), max = Math.max(...values);
    const d = values.map((v, i) => `${i ? "L" : "M"}${((i / (values.length - 1)) * W).toFixed(1)},${(3 + (1 - (v - min) / (max - min || 1)) * (H - 6)).toFixed(1)}`).join("");
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
  }

  TS.lineChart = lineChart;
  TS.sparkline = sparkline;
})();
