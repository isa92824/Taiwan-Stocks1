"""共用工具：HTTP 請求、證交所資料解析、讀寫資料檔。只用 Python 標準函式庫。"""
from __future__ import annotations

import json
import re
import time
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
TPE = timezone(timedelta(hours=8))
HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json, text/plain, */*"}
REQUEST_GAP = 3.5  # 證交所會封鎖密集請求，每次間隔至少 3 秒（CLAUDE.md 5.2）

_last_request = 0.0


def get(url: str, *, as_json: bool = True, retries: int = 3):
    """GET 一個網址；失敗或回傳非 JSON 時等待後重試（10、20 秒），最多 3 次。"""
    global _last_request
    for attempt in range(1, retries + 1):
        wait = REQUEST_GAP - (time.time() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.time()
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=40) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body) if as_json else body
        except Exception as exc:  # 網路中斷、被擋、回傳 HTML 等
            if attempt == retries:
                raise RuntimeError(f"請求失敗（{attempt} 次）：{url}：{exc}") from exc
            pause = 10 * attempt  # 被暫時擋下（例如 HTTP 307）時逐次拉長等待
            print(f"  … 第 {attempt} 次失敗，{pause} 秒後重試：{exc}")
            time.sleep(pause)


def today_tpe() -> date:
    return datetime.now(TPE).date()


def roc_to_iso(text: str) -> str:
    """民國日期轉西元：'1151113' 或 '115/11/13' → '2026-11-13'。"""
    digits = re.sub(r"\D", "", text)
    year, month, day = int(digits[:-4]) + 1911, int(digits[-4:-2]), int(digits[-2:])
    return f"{year:04d}-{month:02d}-{day:02d}"


def num(text) -> float | None:
    """'43,675.12'、'+0.60'、'X0.00' → 數字；無法轉換回傳 None。"""
    if text is None:
        return None
    cleaned = re.sub(r"[^\d.\-+]", "", str(text))
    if cleaned in ("", "+", "-", "."):
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def sign_of(html_or_text: str) -> int:
    """證交所漲跌欄位可能是 '+'、'-' 或 "<p style='color:red'>+</p>"。"""
    text = re.sub(r"<[^>]+>", "", str(html_or_text)).strip()
    return -1 if text.startswith("-") else 1


def load_json(path: Path, default=None):
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def save_prices(slug: str, series: dict) -> None:
    """價格檔：每個交易日一行，方便在 git diff 看出新增了哪天。"""
    head = {k: v for k, v in series.items() if k != "points"}
    lines = ",\n    ".join(json.dumps(p, ensure_ascii=False) for p in series["points"])
    body = json.dumps(head, ensure_ascii=False, indent=2)[:-2]
    path = DATA / "prices" / f"{slug}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body + ',\n  "points": [\n    ' + lines + "\n  ]\n}\n", encoding="utf-8")


def registry() -> dict:
    return load_json(DATA / "indices.json")


def write_latest(reg: dict) -> str:
    """依各價格檔的最後一筆產生 data/latest.json，回傳資料日期。"""
    items, dates = {}, []
    for it in reg["indices"]:
        series = load_json(DATA / "prices" / f"{it['slug']}.json")
        if not series or not series["points"]:
            continue
        d, close, pct = series["points"][-1]
        items[it["slug"]] = {"date": d, "close": close, "pct": pct}
        dates.append(d)
    as_of = max(dates) if dates else ""
    save_json(DATA / "latest.json", {"as_of": as_of, "items": items})
    return as_of


def chain_custom(prev_value: float | None, returns: list[float]) -> float | None:
    """自編族群：前一日值 × (1 + 成分股日報酬平均)，基準日為 100（CLAUDE.md 5.6）。"""
    if not returns:
        return prev_value
    if prev_value is None:
        return 100.0
    return round(prev_value * (1 + sum(returns) / len(returns)), 2)


def stock_return(close: float | None, change: float | None, prev_close: float | None) -> float | None:
    """個股日報酬：漲跌價差 ÷ 參考價；漲跌價差讀不到時改用前一日收盤價。"""
    if close is None:
        return None
    if change is not None and close - change > 0:
        return change / (close - change)
    if prev_close:
        return close / prev_close - 1
    return None
