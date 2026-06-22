"""
Prototype IBKR Flex Web Service fetcher.

À faire avant utilisation réelle :
1. Créer une Flex Query dans IBKR Client Portal.
2. Mettre le token et le query ID dans GitHub Secrets :
   - IBKR_FLEX_TOKEN
   - IBKR_FLEX_QUERY_ID
3. Adapter le parsing XML selon les champs choisis dans la Flex Query.

Ce script écrit data/trades.json pour le site statique.
"""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "trades.json"


def fetch_url(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read().decode("utf-8")


def request_flex_report(token: str, query_id: str) -> str:
    params = urllib.parse.urlencode({
        "t": token,
        "q": query_id,
        "v": "3",
    })
    url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?{params}"
    xml = fetch_url(url)
    root = ET.fromstring(xml)

    if root.findtext(".//Status") != "Success":
        raise RuntimeError(f"IBKR request failed: {xml}")

    reference_code = root.findtext(".//ReferenceCode")
    if not reference_code:
        raise RuntimeError(f"No ReferenceCode in IBKR response: {xml}")

    return reference_code


def get_flex_report(token: str, reference_code: str) -> str:
    params = urllib.parse.urlencode({
        "t": token,
        "q": reference_code,
        "v": "3",
    })
    url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?{params}"

    for _ in range(10):
        xml = fetch_url(url)
        if "Statement generation in progress" not in xml:
            return xml
        time.sleep(6)

    raise TimeoutError("IBKR report was not ready after waiting.")


def parse_trades(xml: str) -> list[dict]:
    """
    Adapter cette fonction aux champs exacts de ta Flex Query.
    Les noms d'attributs IBKR peuvent varier selon le rapport choisi.
    """
    root = ET.fromstring(xml)
    trades = []

    for trade in root.findall(".//Trade"):
        symbol = trade.attrib.get("symbol") or trade.attrib.get("underlyingSymbol") or ""
        qty = float(trade.attrib.get("quantity", "0") or 0)
        proceeds = float(trade.attrib.get("proceeds", "0") or 0)
        commission = float(trade.attrib.get("ibCommission", "0") or 0)
        realized_pnl = float(trade.attrib.get("fifoPnlRealized", "0") or 0)
        trade_date = trade.attrib.get("dateTime", "")[:10] or trade.attrib.get("tradeDate", "")

        trades.append({
            "trade_id": trade.attrib.get("tradeID") or trade.attrib.get("ibExecID") or "",
            "open_date": trade_date,
            "close_date": trade_date,
            "symbol": symbol,
            "side": "Long" if qty > 0 else "Short",
            "quantity": abs(qty),
            "entry_price": "",
            "exit_price": "",
            "currency": trade.attrib.get("currency", "USD"),
            "realized_pnl": realized_pnl,
            "commission": commission,
            "strategy": "",
            "note": "",
            "raw_proceeds": proceeds,
        })

    return trades


def main() -> int:
    token = os.environ.get("IBKR_FLEX_TOKEN")
    query_id = os.environ.get("IBKR_FLEX_QUERY_ID")

    if not token or not query_id:
        print("IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID missing. Keeping existing data.")
        return 0

    reference_code = request_flex_report(token, query_id)
    xml = get_flex_report(token, reference_code)
    trades = parse_trades(xml)

    payload = {
        "last_updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "trades": trades,
    }

    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(trades)} trades to {OUTPUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
