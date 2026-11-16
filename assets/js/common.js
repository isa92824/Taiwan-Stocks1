/* Taiwan-Stocks — 共用函式：讀 JSON、數字格式、漲跌顏色、新聞讀取、頁首頁尾 */
(function () {
  "use strict";

  const cache = new Map();

  function getJSON(path) {
    if (!cache.has(path)) {
      cache.set(path, fetch(path, { cache: "no-cache" }).then((res) => {
        if (!res.ok) throw new Error(`讀不到 ${path}（HTTP ${res.status}）`);
        return res.json();
      }));
    }
    return cache.get(path);
  }

  /** 讀得到回傳內容，讀不到（例如當天沒有檔案）回傳 null */
  const tryJSON = (path) => getJSON(path).catch(() => null);

  const loadRegistry = () => getJSON("data/indices.json");
  const loadLatest = () => getJSON("data/latest.json");
  const loadPrices = (slug) => getJSON(`data/prices/${slug}.json`);

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

  function fmt(n, digits = 2) {
    if (n == null || Number.isNaN(n)) return "—";
    return Number(n).toLocaleString("zh-TW", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  /** 百分比：兩位小數＋正負號（CLAUDE.md 第 10 節），n 的單位是 % */
  function pct(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const sign = n > 0 ? "+" : n < 0 ? "−" : "±";
    return `${sign}${Math.abs(n).toFixed(2)}%`;
  }

  /** 漲紅跌綠 */
  const trend = (n) => (n == null || Number.isNaN(n) || n === 0 ? "flat" : n > 0 ? "up" : "down");

  /** 晶圓圖顏色：±3% 封頂，0 為淺灰 */
  function heat(p) {
    const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    const neutral = [230, 235, 240], red = [215, 38, 61], green = [18, 146, 90];
    const t = Math.min(Math.abs(p || 0) / 3, 1);
    const rgb = mix(neutral, p >= 0 ? red : green, 0.25 + 0.75 * t);
    if (!p) return { fill: `rgb(${neutral})`, ink: "#0D1B2E" };
    return { fill: `rgb(${rgb})`, ink: t > 0.35 ? "#FFFFFF" : "#0D1B2E" };
  }

  /** 區間漲跌（%）：最後一筆對比往前 n 個交易日；資料不足回傳 null */
  function change(points, n) {
    if (points.length <= n) return null;
    const last = points[points.length - 1][1];
    const base = points[points.length - 1 - n][1];
    return (last / base - 1) * 100;
  }

  const sinceStart = (points) => (points.length > 1 ? (points[points.length - 1][1] / points[0][1] - 1) * 100 : null);

  function tpeDate(offsetDays = 0) {
    const d = new Date(Date.now() - offsetDays * 86400000);
    return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  }

  /** 讀某一天的新聞標註，合併 raw 檔的標題、網址、來源與時間 */
  async function loadNewsDay(date) {
    const analysis = await tryJSON(`data/news/analysis/${date}.json`);
    if (!analysis) return null;
    const raw = await tryJSON(`data/news/raw/${date}.json`);
    const byId = new Map((raw?.items || []).map((n) => [n.id, n]));
    const items = analysis.items
      .map((a) => ({ ...a, news: byId.get(a.news_id), date }))
      .filter((a) => a.news);
    return { date, note: analysis.note, analyzedAt: analysis.analyzed_at, items };
  }

  /** 有標註的日期清單（data/news/analysis/index.json），新到舊 */
  async function newsDates() {
    const idx = await tryJSON("data/news/analysis/index.json");
    return [...(idx?.dates || [])].sort().reverse();
  }

  /** 最近一天有標註的新聞 */
  async function latestNews() {
    const [d] = await newsDates();
    return d ? loadNewsDay(d) : null;
  }

  /** 近 N 天所有標註（項目頁用） */
  async function recentNews(days = 7) {
    const since = tpeDate(days - 1);
    const dates = (await newsDates()).filter((d) => d >= since);
    return (await Promise.all(dates.map(loadNewsDay))).filter(Boolean);
  }

  const DIR_CLASS = { 偏多: "bull", 偏空: "bear", 中性: "neutral" };

  /** 一則新聞標註的 HTML */
  function newsItemHTML(a, reg, latest) {
    const n = a.news;
    const time = n.published.slice(5, 16).replace("T", " ").replace("-", "/");
    const chips = a.indices.map((slug) => {
      const it = reg.indices.find((x) => x.slug === slug);
      if (!it) return "";
      const p = latest?.items?.[slug]?.pct;
      return `<a class="chip" href="index-page.html?id=${esc(slug)}">${esc(it.short)}<span class="num ${trend(p)}">${pct(p)}</span></a>`;
    }).join("");
    const reason = esc(a.reason).replace(/→/g, '<span class="arrow">→</span>');
    const boxes = [1, 2, 3].map((k) => `<i class="${k <= a.strength ? "on" : ""}"></i>`).join("");
    return `
      <li class="news-item panel ${DIR_CLASS[a.direction] || "neutral"}" data-dir="${esc(a.direction)}">
        <div class="verdict"><span>${esc(a.direction)}</span><span class="strength" aria-label="強度 ${a.strength}">${boxes}</span></div>
        <div class="news-body">
          <h3><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h3>
          <div class="news-meta">${esc(n.source)}　<span class="num">${esc(time)}</span></div>
          <p class="news-reason">${reason}</p>
          <div class="chips">${chips}</div>
        </div>
      </li>`;
  }

  function renderChrome(page) {
    const header = document.getElementById("site-header");
    if (header) {
      header.outerHTML = `
        <header class="site-header">
          <div class="wrap">
            <a class="brand" href="index.html" aria-label="回到總覽">
              <svg viewBox="0 0 26 26" aria-hidden="true">
                <circle cx="13" cy="13" r="12" fill="#fff" stroke="#3A3FD9" stroke-width="1.6"/>
                <rect x="7" y="7" width="5.5" height="5.5" fill="#D7263D"/><rect x="13.5" y="7" width="5.5" height="5.5" fill="#3A3FD9"/>
                <rect x="7" y="13.5" width="5.5" height="5.5" fill="#3A3FD9"/><rect x="13.5" y="13.5" width="5.5" height="5.5" fill="#12925A"/>
              </svg>
              <strong>台股晶圓圖</strong><span>Taiwan-Stocks</span>
            </a>
            <nav class="header-meta" aria-label="主要導覽">
              <a href="index.html"${page === "home" ? ' aria-current="page"' : ""}>總覽</a>
              <span id="as-of"><span class="status-dot"></span>讀取中</span>
            </nav>
          </div>
        </header>`;
    }
    const footer = document.getElementById("site-footer");
    if (footer) {
      footer.outerHTML = `
        <footer class="site-footer">
          <div class="wrap">
            <p>價格來自臺灣證券交易所，每個交易日收盤後更新。新聞標註由 Claude Code 依專案規則產生，只說明可能的影響途徑，不構成投資建議。</p>
            <p><a href="https://github.com/isa92824/Taiwan-Stocks">GitHub</a>　<a href="https://github.com/isa92824/Taiwan-Stocks/blob/main/CLAUDE.md">CLAUDE.md</a></p>
          </div>
        </footer>`;
    }
    loadLatest().then((l) => {
      const el = document.getElementById("as-of");
      if (el) el.innerHTML = `<span class="status-dot"></span><span class="num">${esc(l.as_of)}</span> 收盤`;
    }).catch(() => {});
  }

  function showError(el, err) {
    el.innerHTML = `<p class="empty">資料載入失敗：${esc(err.message)}。在本機預覽請用 <code>python3 -m http.server</code> 開啟。</p>`;
    console.error(err);
  }

  window.TS = {
    getJSON, tryJSON, loadRegistry, loadLatest, loadPrices, esc, fmt, pct, trend, heat,
    change, sinceStart, tpeDate, loadNewsDay, latestNews, recentNews, newsItemHTML, renderChrome, showError,
  };
})();
