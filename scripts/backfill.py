#!/usr/bin/env python3
"""回補歷史價格，重新建立 data/prices/<slug>.json。

用法：
    python3 scripts/backfill.py                      # 從當月 1 日回補全部項目
    python3 scripts/backfill.py --since 2025-11-17   # 指定起始日（例如回補一年）
    python3 scripts/backfill.py --since 2026-11-01 semi 00878   # 只回補指定項目

資料來源（CLAUDE.md 5.2）：
  指數：證交所每日收盤行情 MI_INDEX（一次一天，含所有指數）
  ETF 與自編族群成分股：證交所個股日成交資訊 STOCK_DAY（一次一個月）
每次請求間隔 3.5 秒，回補一個月約 1 分鐘、一年約 15～20 分鐘。
"""
from __future__ import annotations

import sys
from datetime import date, timedelta

import twse

MI_INDEX = "https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?date={d}&type=IND&response=json"
STOCK_DAY = "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?date={d}&stockNo={code}&response=json"


def weekdays(since: date, until: date):
    d = since
    while d <= until:
        if d.weekday() < 5:
            yield d
        d += timedelta(days=1)


def month_starts(since: date, until: date):
    d = since.replace(day=1)
    while d <= until:
        yield d
        d = (d.replace(day=28) + timedelta(days=4)).replace(day=1)


def fetch_index_day(d: date) -> dict[str, tuple[float, float]]:
    """回傳 {指數名稱: (收盤, 漲跌百分比)}；休市日回傳空 dict。"""
    data = twse.get(MI_INDEX.format(d=d.strftime("%Y%m%d")))
    if data.get("stat") != "OK":
        return {}
    out = {}
    for table in data.get("tables", []):
        fields = table.get("fields") or []
        if "收盤指數" not in fields:
            continue
        i_name, i_close = 0, fields.index("收盤指數")  # 第一欄是指數名稱（各表欄名不同）
        i_pct = next(i for i, f in enumerate(fields) if f.startswith("漲跌百分比"))
        for row in table.get("data", []):
            close, pct = twse.num(row[i_close]), twse.num(row[i_pct])
            if close is not None:
                out.setdefault(row[i_name], (close, pct or 0.0))
    return out


def fetch_stock_month(code: str, month: date) -> dict[str, tuple[float, float | None]]:
    """回傳 {日期: (收盤價, 漲跌價差)}。"""
    data = twse.get(STOCK_DAY.format(d=month.strftime("%Y%m01"), code=code))
    if data.get("stat") != "OK":
        return {}
    fields = data["fields"]
    i_close, i_chg = fields.index("收盤價"), fields.index("漲跌價差")
    out = {}
    for row in data.get("data", []):
        close = twse.num(row[i_close])
        if close is not None:
            out[twse.roc_to_iso(row[0])] = (close, twse.num(row[i_chg]))
    return out


def main(argv: list[str]) -> int:
    since = twse.today_tpe().replace(day=1)
    if "--since" in argv:
        i = argv.index("--since")
        since = date.fromisoformat(argv[i + 1])
        argv = argv[:i] + argv[i + 2:]
    until = twse.today_tpe()
    reg = twse.registry()
    items = [it for it in reg["indices"] if not argv or it["slug"] in argv]

    # 1. 指數：逐日抓 MI_INDEX
    index_items = [it for it in items if it["kind"] == "index"]
    index_days: dict[str, dict] = {}
    if index_items:
        days = list(weekdays(since, until))
        print(f"抓取指數：{days[0]} ～ {days[-1]}，共 {len(days)} 個平日")
        for d in days:
            rows = fetch_index_day(d)
            if rows:
                index_days[d.isoformat()] = rows
                print(f"  ✓ {d} {len(rows)} 個指數")
            else:
                print(f"  - {d} 休市或尚無資料")

    # 2. 個股與 ETF：逐月抓 STOCK_DAY
    codes = sorted({it["code"] for it in items if it["kind"] == "etf"}
                   | {c["code"] for it in items if it["kind"] == "custom" for c in it["components"]})
    stock_rows: dict[str, dict] = {}
    for code in codes:
        rows: dict = {}
        for m in month_starts(since, until):
            rows.update(fetch_stock_month(code, m))
        stock_rows[code] = {d: v for d, v in rows.items() if d >= since.isoformat()}
        print(f"  ✓ {code} {len(stock_rows[code])} 個交易日")

    # 3. 組成價格檔
    for it in items:
        slug = it["slug"]
        points: list = []
        extra: dict = {}
        if it["kind"] == "index":
            for d in sorted(index_days):
                hit = index_days[d].get(it["twse_name"])
                if hit:
                    points.append([d, hit[0], round(hit[1], 2)])
        elif it["kind"] == "etf":
            prev = None
            for d, (close, chg) in sorted(stock_rows[it["code"]].items()):
                r = twse.stock_return(close, chg, prev)
                points.append([d, close, round(r * 100, 2) if r is not None else 0.0])
                prev = close
        else:  # custom
            comps = [c["code"] for c in it["components"]]
            all_days = sorted({d for c in comps for d in stock_rows[c]})
            value, prev_close = None, {}
            for d in all_days:
                rets = []
                for c in comps:
                    if d in stock_rows[c]:
                        close, chg = stock_rows[c][d]
                        r = twse.stock_return(close, chg, prev_close.get(c))
                        if chg is None:
                            print(f"  注意：{c} {d} 漲跌價差無法解析，改用前一日收盤價計算")
                        if r is not None:
                            rets.append(r)
                        prev_close[c] = close
                first = value is None
                value = twse.chain_custom(value, rets)
                pct = 0.0 if first else round(sum(rets) / len(rets) * 100, 2) if rets else 0.0
                points.append([d, value, pct])
            extra = {"base_date": all_days[0] if all_days else "", "last_closes": prev_close}

        if not points:
            print(f"✗ {slug}：沒有抓到資料，請檢查名稱或代號")
            continue
        twse.save_prices(slug, {"slug": slug, "kind": it["kind"], **extra, "points": points})
        print(f"✓ {slug}：{len(points)} 筆，{points[0][0]} ～ {points[-1][0]}")

    as_of = twse.write_latest(reg)
    print(f"latest.json 資料日期：{as_of}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
