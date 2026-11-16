/* Taiwan-Stocks — 總覽頁：晶圓圖、分組讀數表、今日新聞標註（CLAUDE.md 第 8 節） */
(function () {
  "use strict";
  const { esc, fmt, pct, trend } = TS;

  async function main() {
    TS.renderChrome("home");
    const hero = document.getElementById("hero-text");
    try {
      const [reg, latest] = await Promise.all([TS.loadRegistry(), TS.loadLatest()]);
      const series = Object.fromEntries(await Promise.all(
        reg.indices.map(async (it) => [it.slug, await TS.loadPrices(it.slug).catch(() => null)])
      ));
      const rows = reg.indices
        .filter((it) => latest.items[it.slug])
        .map((it) => ({ ...it, ...latest.items[it.slug], points: series[it.slug]?.points || [] }));

      renderHero(hero, rows, latest);
      TS.renderWafer(document.getElementById("wafer"), rows);
      renderTables(document.getElementById("tables"), reg, rows);
      renderNews(document.getElementById("news"), reg, latest);
    } catch (err) {
      TS.showError(hero, err);
    }
  }

  function renderHero(el, rows, latest) {
    const taiex = rows.find((r) => r.slug === "taiex") || rows[0];
    const prev = taiex.points.length > 1 ? taiex.points[taiex.points.length - 2][1] : null;
    const diff = prev ? taiex.close - prev : null;
    const up = rows.filter((r) => r.pct > 0).length;
    const down = rows.filter((r) => r.pct < 0).length;
    const flat = rows.length - up - down;
    const [y, m, d] = latest.as_of.split("-").map(Number);
    const bars = [...rows].sort((a, b) => b.pct - a.pct).map((r) => `<span style="background:${TS.heat(r.pct).fill}" title="${esc(r.short)} ${pct(r.pct)}"></span>`).join("");
    el.innerHTML = `
      <h1>${y} 年 ${m} 月 ${d} 日　加權指數收盤</h1>
      <p class="big">${fmt(taiex.close)}</p>
      <div class="chg ${trend(taiex.pct)}">${diff == null ? "" : (diff > 0 ? "+" : "−") + fmt(Math.abs(diff))}<small>${pct(taiex.pct)}</small></div>
      <p class="lead">追蹤 ${rows.length} 個指數、族群與 ETF。右邊每一顆晶粒是一個項目，紅色代表上漲、綠色代表下跌，顏色越深漲跌越大。點晶粒可以看走勢與相關新聞。</p>
      <div class="breadth" aria-hidden="true">${bars}</div>
      <div class="breadth-label">上漲 <span class="num up">${up}</span>　下跌 <span class="num down">${down}</span>${flat ? `　平盤 <span class="num">${flat}</span>` : ""}</div>
      <div class="scale"><span class="num">−3%</span><span class="bar"></span><span class="num">+3%</span></div>`;
  }

  function tableHTML(title, rows) {
    return `
      <table class="readout">
        <caption>${esc(title)}</caption>
        <thead><tr><th scope="col">名稱</th><th scope="col">收盤</th><th scope="col">日漲跌</th><th scope="col" class="col-acc">區間累計</th><th scope="col" class="col-spark">走勢</th></tr></thead>
        <tbody>
          ${rows.map((r) => {
            const acc = TS.sinceStart(r.points);
            const tag = r.kind === "etf" ? r.code : r.kind === "custom" ? "自編" : "";
            return `<tr data-href="index-page.html?id=${esc(r.slug)}">
              <td><a href="index-page.html?id=${esc(r.slug)}">${esc(r.kind === "etf" ? r.short : r.short.replace("（本站自編）", ""))}</a>${tag ? `<span class="tag num">${esc(tag)}</span>` : ""}</td>
              <td class="num">${fmt(r.close)}</td>
              <td class="num ${trend(r.pct)}">${pct(r.pct)}</td>
              <td class="num col-acc ${trend(acc)}">${pct(acc)}</td>
              <td class="col-spark"><span class="spark" data-slug="${esc(r.slug)}"></span></td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>`;
  }

  function renderTables(el, reg, rows) {
    const by = (g) => rows.filter((r) => r.group === g);
    const left = reg.groups.filter((g) => g !== "類股指數");
    const start = rows[0]?.points[0]?.[0] || "";
    el.innerHTML = `
      <div class="block-head"><h2>分組讀數</h2><p>區間累計自 <span class="num">${esc(start)}</span> 起算</p></div>
      <div class="readout-grid">
        <div class="panel">${left.map((g) => (by(g).length ? tableHTML(g, by(g)) : "")).join("")}</div>
        <div class="panel">${tableHTML("類股指數", by("類股指數"))}</div>
      </div>`;
    rows.forEach((r) => {
      const box = el.querySelector(`.spark[data-slug="${r.slug}"]`);
      if (box) TS.sparkline(box, r.points.map((p) => p[1]), r.points.length && TS.sinceStart(r.points) < 0 ? "#12925A" : "#D7263D");
    });
    el.querySelectorAll("tr[data-href]").forEach((tr) => {
      tr.addEventListener("click", (e) => { if (e.target.tagName !== "A") location.href = tr.dataset.href; });
    });
  }

  async function renderNews(el, reg, latest) {
    const day = await TS.latestNews();
    if (!day || !day.items.length) {
      el.innerHTML = `<div class="block-head"><h2>新聞標註</h2></div><p class="empty">最近 7 天還沒有新聞標註。對 Claude Code 說「更新今天的新聞分析」即可產生。</p>`;
      return;
    }
    const order = { 偏空: 0, 偏多: 1, 中性: 2 };
    const items = [...day.items].sort((a, b) => b.strength - a.strength || order[a.direction] - order[b.direction]);
    const count = (d) => items.filter((a) => a.direction === d).length;
    el.innerHTML = `
      <div class="block-head">
        <h2>新聞標註</h2>
        <div class="filters" role="group" aria-label="依方向篩選">
          <button type="button" aria-pressed="true" data-dir="">全部 <span class="num">${items.length}</span></button>
          <button type="button" aria-pressed="false" data-dir="偏多">偏多 <span class="num">${count("偏多")}</span></button>
          <button type="button" aria-pressed="false" data-dir="偏空">偏空 <span class="num">${count("偏空")}</span></button>
          <button type="button" aria-pressed="false" data-dir="中性">中性 <span class="num">${count("中性")}</span></button>
        </div>
      </div>
      ${day.note ? `<p class="news-context">${esc(day.date)}：${esc(day.note)}</p>` : ""}
      <ul class="news-list">${items.map((a) => TS.newsItemHTML(a, reg, latest)).join("")}</ul>`;
    el.querySelectorAll(".filters button").forEach((btn) => btn.addEventListener("click", () => {
      el.querySelectorAll(".filters button").forEach((b) => b.setAttribute("aria-pressed", b === btn));
      el.querySelectorAll(".news-item").forEach((li) => { li.hidden = btn.dataset.dir && li.dataset.dir !== btn.dataset.dir; });
    }));
  }

  main();
})();
