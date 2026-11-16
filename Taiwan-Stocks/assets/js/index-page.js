/* Taiwan-Stocks — 項目頁：index-page.html?id=<slug>，指數、ETF、自編族群共用（CLAUDE.md 第 8 節） */
(function () {
  "use strict";
  const { esc, fmt, pct, trend } = TS;
  const RANGES = [["1 個月", 21], ["3 個月", 63], ["1 年", 0]];

  async function main() {
    TS.renderChrome("item");
    const app = document.getElementById("app");
    const slug = new URLSearchParams(location.search).get("id");
    try {
      const [reg, latest] = await Promise.all([TS.loadRegistry(), TS.loadLatest()]);
      const it = reg.indices.find((x) => x.slug === slug);
      if (!it) {
        app.innerHTML = `<p class="empty">查無此項目（${esc(slug || "未指定")}）。<a href="index.html">回到總覽</a></p>`;
        return;
      }
      const series = await TS.loadPrices(slug);
      document.title = `${it.short.replace("（本站自編）", "")}｜台股晶圓圖`;
      render(app, it, series.points, series, reg, latest);
    } catch (err) {
      TS.showError(app, err);
    }
  }

  function specHTML(it, series) {
    if (it.kind === "etf") {
      return `
        <dl>
          <dt>證券代號</dt><dd class="num">${esc(it.code)}</dd>
          <dt>類型</dt><dd>${esc(it.etf_type)} ETF</dd>
          <dt>發行投信</dt><dd>${esc(it.issuer)}</dd>
          <dt>${it.etf_type === "被動式" ? "追蹤指數" : "績效指標"}</dt><dd>${esc(it.benchmark)}</dd>
        </dl>
        <p class="notice">走勢為 ETF 市價，未還原配息；除息日的下跌缺口不代表實際虧損。${it.etf_type === "主動式" ? "主動式 ETF 由經理人選股，持股每天可能變動。" : ""}</p>`;
    }
    if (it.kind === "custom") {
      return `
        <dl>
          <dt>成分股</dt><dd><ul>${it.components.map((c) => `<li>${esc(c.name)} <span class="num muted">${esc(c.code)}</span></li>`).join("")}</ul></dd>
          <dt>基準日</dt><dd class="num">${esc(series.base_date)} = 100</dd>
          <dt>計算方式</dt><dd>每日取成分股日報酬平均，接在前一日數值上（每日等權重連鎖）</dd>
        </dl>
        <p class="notice">本站自編，非官方指數，僅供觀察族群走勢。數值是相對基準日的倍數，不能和官方指數點數直接比較。</p>`;
    }
    return `
      <dl>
        <dt>官方名稱</dt><dd>${esc(it.twse_name)}</dd>
        <dt>分組</dt><dd>${esc(it.group)}</dd>
        <dt>資料來源</dt><dd>臺灣證券交易所每日收盤行情</dd>
      </dl>`;
  }

  async function render(app, it, points, series, reg, latest) {
    const last = points[points.length - 1];
    const prev = points.length > 1 ? points[points.length - 2][1] : null;
    const diff = prev != null ? last[1] - prev : null;
    const name = it.short.replace("（本站自編）", "");
    const badge2 = it.kind === "etf" ? it.etf_type : it.kind === "custom" ? "本站自編" : "官方指數";

    app.innerHTML = `
      <header class="item-head">
        <div>
          <a class="back" href="index.html">← 回到總覽</a>
          <h1>${esc(name)}</h1>
          <div class="code"><span class="badge">${esc(it.group)}</span><span class="badge alt">${esc(badge2)}</span> ${esc(it.kind === "etf" ? it.code : it.slug)}</div>
          <p class="desc">${esc(it.description)}</p>
        </div>
        <div class="price">
          <div class="big">${fmt(last[1])}</div>
          <div class="chg ${trend(last[2])}">${diff == null ? "" : (diff > 0 ? "+" : diff < 0 ? "−" : "") + fmt(Math.abs(diff))}　${pct(last[2])}</div>
          <div class="date num">${esc(last[0])} 收盤</div>
        </div>
      </header>

      <div class="metrics panel">
        <div class="metric"><div class="label">近 1 個月</div><div class="value ${trend(TS.change(points, 21))}">${pct(TS.change(points, 21))}</div></div>
        <div class="metric"><div class="label">近 3 個月</div><div class="value ${trend(TS.change(points, 63))}">${pct(TS.change(points, 63))}</div></div>
        <div class="metric"><div class="label">近 1 年</div><div class="value ${trend(TS.change(points, 245))}">${pct(TS.change(points, 245))}</div></div>
        <div class="metric"><div class="label">自 ${esc(points[0][0].slice(5).replace("-", "/"))} 起</div><div class="value ${trend(TS.sinceStart(points))}">${pct(TS.sinceStart(points))}</div></div>
      </div>

      <div class="item-grid">
        <section class="panel chart-panel" aria-label="走勢圖">
          <div class="chart-top">
            <h2>走勢</h2>
            <div class="ranges" role="group" aria-label="區間">
              ${RANGES.map(([label, n], i) => `<button type="button" data-n="${n}" aria-pressed="${i === 2}">${label}</button>`).join("")}
            </div>
          </div>
          <div class="chart" id="chart"></div>
          <p class="chart-note">目前有 <span class="num">${points.length}</span> 個交易日的資料，每個交易日收盤後自動增加一筆；資料不足的區間顯示「—」。</p>
        </section>
        <aside class="panel spec"><h2>項目資訊</h2>${specHTML(it, series)}</aside>
      </div>

      <section class="block" id="news"><div class="block-head"><h2>近 7 天相關新聞</h2></div><p class="loading">讀取中…</p></section>`;

    const box = document.getElementById("chart");
    const draw = (n) => TS.lineChart(box, n ? points.slice(-n - 1) : points, { color: it.color, label: `${name}走勢` });
    app.querySelectorAll(".ranges button").forEach((btn) => btn.addEventListener("click", () => {
      app.querySelectorAll(".ranges button").forEach((b) => b.setAttribute("aria-pressed", b === btn));
      draw(Number(btn.dataset.n));
    }));
    draw(0);

    const days = await TS.recentNews(7);
    const related = days.flatMap((d) => d.items).filter((a) => a.indices.includes(it.slug));
    const newsEl = document.getElementById("news");
    newsEl.innerHTML = `
      <div class="block-head"><h2>近 7 天相關新聞</h2><p>共 <span class="num">${related.length}</span> 則提到${esc(name)}</p></div>
      ${related.length ? `<ul class="news-list">${related.map((a) => TS.newsItemHTML(a, reg, latest)).join("")}</ul>`
        : '<p class="empty">最近 7 天的新聞標註沒有提到這個項目。</p>'}`;
  }

  main();
})();
