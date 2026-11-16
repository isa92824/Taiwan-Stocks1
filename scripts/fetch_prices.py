#!/usr/bin/env python3
"""抓最近一個交易日的收盤，接到 data/prices/<slug>.json 尾端，並更新 data/latest.json。

由 GitHub Actions 每個交易日 15:30 執行（CLAUDE.md 第 11 節），也可以手動執行：
    python3 scripts/fetch_prices.py

休市日 API 回傳的日期和檔案最後一筆相同，此時不寫任何檔案。
"""
from __future__ import annotations

import sys

import twse

MI_INDEX = "https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX"
STOCK_DAY_ALL = "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL"


def main() -> int:
    reg = twse.registry()

    idx_rows = twse.get(MI_INDEX)
    stock_rows = twse.get(STOCK_DAY_ALL)
    if not idx_rows or not stock_rows:
        print("✗ API 回傳空資料，不寫入任何檔案")
        return 1

    indices = {}
    for r in idx_rows:
        close = twse.num(r["收盤指數"])
        pct = twse.num(r["漲跌百分比"])
        if close is not None:
            indices[r["指數"]] = (twse.roc_to_iso(r["日期"]), close, pct or 0.0)
    stocks = {}
    for r in stock_rows:
        close = twse.num(r["ClosingPrice"])
        if close is not None:
            stocks[r["Code"]] = (twse.roc_to_iso(r["Date"]), close, twse.num(r["Change"]))

    updated, skipped, missing = [], [], []
    for it in reg["indices"]:
        slug = it["slug"]
        series = twse.load_json(twse.DATA / "prices" / f"{slug}.json") or {"slug": slug, "kind": it["kind"], "points": []}
        last_date = series["points"][-1][0] if series["points"] else ""
        last_value = series["points"][-1][1] if series["points"] else None

        if it["kind"] == "index":
            hit = indices.get(it["twse_name"])
            if not hit:
                missing.append(slug)
                continue
            d, close, pct = hit
            point = [d, close, round(pct, 2)]
        elif it["kind"] == "etf":
            hit = stocks.get(it["code"])
            if not hit:
                missing.append(slug)
                continue
            d, close, chg = hit
            r = twse.stock_return(close, chg, last_value)
            point = [d, close, round(r * 100, 2) if r is not None else 0.0]
        else:  # custom
            last_closes = series.get("last_closes", {})
            rets, d = [], None
            for c in it["components"]:
                hit = stocks.get(c["code"])
                if not hit:
                    continue
                d, close, chg = hit
                r = twse.stock_return(close, chg, last_closes.get(c["code"]))
                if r is not None:
                    rets.append(r)
                last_closes[c["code"]] = close
            if d is None:
                missing.append(slug)
                continue
            value = twse.chain_custom(last_value, rets)
            pct = round(sum(rets) / len(rets) * 100, 2) if rets and last_value is not None else 0.0
            point = [d, value, pct]
            series["last_closes"] = last_closes
            series.setdefault("base_date", d)

        if point[0] <= last_date:
            skipped.append(slug)
            continue
        series["points"].append(point)
        twse.save_prices(slug, series)
        updated.append(slug)

    if missing:
        print(f"✗ API 裡找不到：{', '.join(missing)}（請檢查 indices.json 的名稱或代號）")
    if not updated:
        print("- 沒有新的交易日資料（休市或官方尚未更新），不寫入檔案")
        return 1 if missing else 0
    as_of = twse.write_latest(reg)
    print(f"✓ 已更新 {len(updated)} 項，資料日期 {as_of}")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
