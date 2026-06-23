from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
import time
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "spy.json"


def fetch_url(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0"
        },
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch_spy_from_yahoo() -> dict[str, float]:
    now = int(time.time())

    url = (
        "https://query1.finance.yahoo.com/v8/finance/chart/SPY"
        f"?period1=0&period2={now}&interval=1d"
    )

    raw = fetch_url(url).decode("utf-8")
    payload = json.loads(raw)

    result = payload["chart"]["result"][0]
    timestamps = result["timestamp"]
    closes = result["indicators"]["quote"][0]["close"]

    prices = {}

    for timestamp, close in zip(timestamps, closes):
        if close is None:
            continue

        date = dt.datetime.utcfromtimestamp(timestamp).strftime("%Y-%m-%d")
        prices[date] = float(close)

    if not prices:
        raise RuntimeError("Yahoo Finance returned no SPY prices")

    return prices


def main() -> int:
    prices = fetch_spy_from_yahoo()

    payload = {
        "symbol": "SPY",
        "source": "Yahoo Finance",
        "last_updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "prices": prices,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"Wrote {len(prices)} SPY prices to {OUTPUT}")
    print("Source: Yahoo Finance")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
