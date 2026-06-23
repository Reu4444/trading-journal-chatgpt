from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
import urllib.request


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "spy.json"


def fetch_spy_csv() -> str:
    url = "https://stooq.com/q/d/l/?s=spy.us&i=d"
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def main() -> int:
    csv = fetch_spy_csv()
    lines = csv.strip().splitlines()

    prices = {}

    for line in lines[1:]:
        columns = line.split(",")

        if len(columns) < 5:
            continue

        date = columns[0]
        close = columns[4]

        try:
            prices[date] = float(close)
        except ValueError:
            continue

    payload = {
        "symbol": "SPY",
        "last_updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "prices": prices,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"Wrote {len(prices)} SPY prices to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
