#!/usr/bin/env python3
"""抓台股新聞標題與連結，寫入 data/news/raw/YYYY-MM-DD.json（CLAUDE.md 第 6 節）。

用法：
    python3 scripts/fetch_news.py

- 只存標題、網址、來源、發布時間，不存內文。
- 只保留前一個交易日 13:30 之後發布的新聞。
- 同一天重複執行會合併，不會產生重複。
"""
from __future__ import annotations

import hashlib
import sys
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import twse

YAHOO_RSS = "https://tw.stock.yahoo.com/rss?category=tw-market"
CNYES_API = "https://api.cnyes.com/media/api/v1/newslist/category/tw_stock?limit=30"


def news_id(url: str) -> str:
    return hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]


def from_yahoo() -> list[dict]:
    root = ET.fromstring(twse.get(YAHOO_RSS, as_json=False))
    out = []
    for item in root.iter("item"):
        title = (item.findtext("title") or "").strip()
        url = (item.findtext("link") or "").strip()
        pub = item.findtext("pubDate")
        if not title or not url or not pub:
            continue
        published = parsedate_to_datetime(pub).astimezone(twse.TPE)
        out.append({"title": title, "url": url, "source": "Yahoo股市", "published": published.isoformat(timespec="minutes")})
    return out


def from_cnyes() -> list[dict]:
    data = twse.get(CNYES_API)
    out = []
    for item in data.get("items", {}).get("data", []):
        title = (item.get("title") or "").strip()
        if not title or not item.get("newsId"):
            continue
        published = datetime.fromtimestamp(item["publishAt"], timezone.utc).astimezone(twse.TPE)
        out.append({
            "title": title,
            "url": f"https://news.cnyes.com/news/id/{item['newsId']}",
            "source": "鉅亨網",
            "published": published.isoformat(timespec="minutes"),
        })
    return out


def cutoff_time() -> datetime:
    """前一個交易日 13:30。以加權指數價格檔的日期判斷交易日。"""
    series = twse.load_json(twse.DATA / "prices" / "taiex.json") or {"points": []}
    dates = [p[0] for p in series["points"]]
    today = twse.today_tpe().isoformat()
    prev = [d for d in dates if d < today]
    base = prev[-1] if prev else today
    return datetime.fromisoformat(f"{base}T13:30:00+08:00")


def main() -> int:
    collected, errors = [], []
    for name, fn in (("Yahoo股市", from_yahoo), ("鉅亨網", from_cnyes)):
        try:
            got = fn()
            collected += got
            print(f"✓ {name}：{len(got)} 則")
        except Exception as exc:
            errors.append(name)
            print(f"✗ {name}：{exc}")
    if not collected:
        print("✗ 所有來源都失敗，不寫入檔案")
        return 1

    cutoff = cutoff_time()
    today = twse.today_tpe().isoformat()
    path = twse.DATA / "news" / "raw" / f"{today}.json"
    existing = twse.load_json(path, {"date": today, "items": []})
    seen_urls = {n["url"] for n in existing["items"]}
    seen_titles = {n["title"] for n in existing["items"]}

    added = 0
    for n in sorted(collected, key=lambda x: x["published"]):
        if datetime.fromisoformat(n["published"]) < cutoff:
            continue
        if n["url"] in seen_urls or n["title"] in seen_titles:
            continue
        existing["items"].append({"id": news_id(n["url"]), **n})
        seen_urls.add(n["url"])
        seen_titles.add(n["title"])
        added += 1

    existing["items"].sort(key=lambda x: x["published"], reverse=True)
    existing["cutoff"] = cutoff.isoformat(timespec="minutes")
    twse.save_json(path, existing)
    print(f"✓ 新增 {added} 則，{path.name} 共 {len(existing['items'])} 則（只收 {cutoff:%m/%d %H:%M} 之後）")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
