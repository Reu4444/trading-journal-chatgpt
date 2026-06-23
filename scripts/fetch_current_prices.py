from __future__ import annotations

import datetime as dt
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TRADES_PATH = ROOT / "data" / "trades.json"
OUTPUT = ROOT / "data" / "current_prices.json"


def normalize_symbol(symbol: str) -> str:
    return (
        str(symbol or "")
        .upper()
        .replace("/", "")
        .replace(".", "")
        .replace("-", "")
        .replace(" ", "")
        .strip()
    )


def yahoo_symbol(symbol: str) -> str:
    clean = str(symbol or "").strip().upper()
    clean = clean.replace(".", "-")
    clean = clean.replace(" ", "-")
    return clean


def is_fx_or_excluded(symbol: str, asset_class: str = "") -> bool:
    normalized = normalize_symbol(symbol)
    asset = str(asset_class or "").upper()

    if normalized == "EURJPY" or "EURJPY" in normalized:
        return True

    if asset in {"CASH", "FX", "FOREX"}:
        return True

    if normalized in {"META251031C00790000", "META251031C00795000"}:
        return True

    return False


def fetch_url(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
    )

    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch_latest_price(symbol: str) -> dict | None:
    y_symbol = yahoo_symbol(symbol)
    encoded_symbol = urllib.parse.quote(y_symbol)

    url = (
        f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_symbol}"
        "?range=5d&interval=1d"
    )

    raw = fetch_url(url).decode("utf-8")
    payload = json.loads(raw)

    result = payload.get("chart", {}).get("result")
    if not result:
        return None

    result = result[0]
    meta = result.get("meta", {})
    price = meta.get("regularMarketPrice")

    timestamps = result.get("timestamp") or []
    quote = result.get("indicators", {}).get("quote", [{}])[0]
    closes = quote.get("close") or []

    last_date = None

    if timestamps:
      last_date = dt.datetime.utcfromtimestamp(timestamps[-1]).strftime("%Y-%m-%d")

    if price is None:
        valid_closes = [close for close in closes if close is not None]
        if valid_closes:
            price = valid_closes[-1]

    if price is None:
        return None

    return {
        "symbol": normalize_symbol(symbol),
        "raw_symbol": symbol,
        "yahoo_symbol": y_symbol,
        "price": float(price),
        "last_price_date": last_date,
    }


def main() -> int:
    if not TRADES_PATH.exists():
        raise FileNotFoundError(f"{TRADES_PATH} not found")

    payload = json.loads(TRADES_PATH.read_text(encoding="utf-8"))
    trades = payload.get("trades", [])

    symbols: dict[str, str] = {}

    for trade in trades:
        symbol = trade.get("symbol", "")
        asset_class = trade.get("asset_class", "")

        if not symbol:
            continue

        if is_fx_or_excluded(symbol, asset_class):
            continue

        normalized = normalize_symbol(symbol)

        if not normalized:
            continue

        symbols[normalized] = symbol

    prices = {}
    failures = []

    for normalized, raw_symbol in sorted(symbols.items()):
        try:
            result = fetch_latest_price(raw_symbol)

            if result:
                prices[normalized] = result
                print(f"{raw_symbol}: {result['price']}")
            else:
                failures.append(raw_symbol)
                print(f"{raw_symbol}: no price")
        except Exception as error:
            failures.append(raw_symbol)
            print(f"{raw_symbol}: failed: {error}")

        time.sleep(0.2)

    output_payload = {
        "source": "Yahoo Finance",
        "last_updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "prices": prices,
        "failures": failures,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")

    print(f"Wrote {len(prices)} current prices to {OUTPUT}")
    print(f"Failures: {len(failures)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
