# 台股晶圓圖 Taiwan-Stocks

追蹤台股加權指數、成分指數、類股指數、記憶體族群與四檔 ETF 的靜態網站。總覽頁用一張「晶圓圖」呈現當天漲跌，每顆晶粒是一個追蹤項目；另外附上新聞標註，說明當天的重要新聞可能透過什麼途徑影響哪些指數。

**網站：** https://isa92824.github.io/Taiwan-Stocks/

## 運作方式

| 工作 | 誰做 | 怎麼做 |
|---|---|---|
| 抓收盤價 | GitHub Actions | 每個交易日 15:30 執行 `scripts/fetch_prices.py`，資料來自臺灣證券交易所 OpenAPI |
| 抓新聞標題 | GitHub Actions | 同一個排程執行 `scripts/fetch_news.py`（Yahoo 股市、鉅亨網），只存標題與連結 |
| 新聞影響標註 | Claude Code | 對 Claude Code 說「更新今天的新聞分析」，它依 `CLAUDE.md` 第 7 節產生標註 |
| 顯示網頁 | GitHub Pages | 純 HTML／CSS／JavaScript，只讀 `data/` 裡的 JSON |

不使用前端框架、不需要 build、不需要 API key。

## 專案規則

所有規則寫在 [`CLAUDE.md`](./CLAUDE.md)：資料來源、JSON 格式、新聞標註的判斷依據與用語限制、頁面結構、視覺風格。新增一個指數或 ETF 只要在 `data/indices.json` 加一筆，再執行 `python3 scripts/backfill.py <slug>`。

## 本機預覽

```bash
python3 -m http.server 8000
# 開啟 http://localhost:8000
```

## 常用指令

```bash
python3 scripts/backfill.py                     # 回補當月資料（重建價格檔）
python3 scripts/backfill.py --since 2025-11-17  # 回補一年
python3 scripts/fetch_prices.py                 # 抓最新一個交易日
python3 scripts/fetch_news.py                   # 抓今天的新聞標題
```

## 聲明

本站為課堂作業與資訊整理，新聞標註只說明可能的影響途徑，不構成投資建議。記憶體族群為本站自行計算，非官方指數。
