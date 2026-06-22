"""
IBKR Flex Web Service fetcher - V2 round-trip matching.

What it does:
- Downloads the IBKR Flex report using IBKR_FLEX_TOKEN and IBKR_FLEX_QUERY_ID.
- Reads executions from the Flex XML.
- Matches entries and exits FIFO by symbol + currency.
- Outputs grouped closed trades to data/trades.json for the GitHub Pages journal.
- Keeps unmatched positions as open trades with close_date empty.

Required Flex Query section:
- Trades / Executions

Recommended fields in the Flex Query:
- TradeID or IBExecID
- DateTime or TradeDate
- Symbol
- Buy/Sell
- Quantity
- TradePrice
- Currency
- IBCommission
- FifoPnlRealized
"""

from __future__ import annotations

import datetime as dt
import json
import os
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
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
    params = urllib.parse.urlencode({"t": token, "q": query_id, "v": "3"})
    url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest?{params}"
    xml = fetch_url(url)
    root = ET.fromstring(xml)

    status = root.findtext(".//Status")
    if status != "Success":
        raise RuntimeError(f"IBKR request failed: {xml}")

    reference_code = root.findtext(".//ReferenceCode")
    if not reference_code:
        raise RuntimeError(f"No ReferenceCode in IBKR response: {xml}")

    return reference_code


def get_flex_report(token: str, reference_code: str) -> str:
    params = urllib.parse.urlencode({"t": token, "q": reference_code, "v": "3"})
    url = f"https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?{params}"

    for _ in range(15):
        xml = fetch_url(url)
        if "Statement generation in progress" not in xml:
            return xml
        time.sleep(6)

    raise TimeoutError("IBKR report was not ready after waiting.")


def first_attr(node: ET.Element, names: list[str], default: str = "") -> str:
    for name in names:
        if name in node.attrib and node.attrib[name] not in ("", None):
            return node.attrib[name]
    return default


def to_float(value: str | None, default: float = 0.0) -> float:
    if value in ("", None):
        return default
    try:
        return float(str(value).replace(",", ""))
    except ValueError:
        return default


def normalize_side(raw: str, quantity: float) -> str:
    side = (raw or "").strip().upper()
    if side in {"BUY", "BOT", "B"}:
        return "BUY"
    if side in {"SELL", "SLD", "S"}:
        return "SELL"
    return "BUY" if quantity > 0 else "SELL"


@dataclass
class Lot:
    trade_id: str
    date: str
    symbol: str
    side: str
    quantity: float
    remaining: float
    price: float
    currency: str
    commission: float
    raw: dict = field(default_factory=dict)


def parse_executions(xml: str) -> list[dict]:
    root = ET.fromstring(xml)
    executions = []

    for trade in root.findall(".//Trade"):
        symbol = first_attr(trade, ["symbol", "underlyingSymbol", "description"])
        if not symbol:
            continue

        raw_qty = to_float(first_attr(trade, ["quantity", "shares"]))
        side = normalize_side(first_attr(trade, ["buySell", "side"], ""), raw_qty)
        qty = abs(raw_qty)

        price = to_float(first_attr(trade, ["tradePrice", "price", "levelOfDetailPrice"]))
        currency = first_attr(trade, ["currency", "fxCurrency"], "USD")
        date_time = first_attr(trade, ["dateTime", "tradeDate", "settleDate"])
        trade_date = date_time[:10] if date_time else ""

        executions.append({
            "trade_id": first_attr(trade, ["tradeID", "ibExecID", "execID"]),
            "date_time": date_time,
            "date": trade_date,
            "symbol": symbol,
            "side": side,
            "quantity": qty,
            "price": price,
            "currency": currency,
            "commission": abs(to_float(first_attr(trade, ["ibCommission", "commission"]))),
            "fifo_pnl_realized": to_float(first_attr(trade, ["fifoPnlRealized", "realizedPnl"])),
            "asset_class": first_attr(trade, ["assetCategory", "secType"]),
            "exchange": first_attr(trade, ["listingExchange", "exchange"]),
        })

    executions.sort(key=lambda x: (x["date_time"], x["trade_id"]))
    return executions


def match_round_trips(executions: list[dict]) -> tuple[list[dict], list[dict]]:
    """
    FIFO matching.
    Long entry = BUY, long exit = SELL.
    Short entry = SELL, short cover = BUY.
    """
    lots_by_key: dict[tuple[str, str], deque[Lot]] = {}
    closed_trades: list[dict] = []

    for ex in executions:
        key = (ex["symbol"], ex["currency"])
        lots = lots_by_key.setdefault(key, deque())

        qty_to_process = ex["quantity"]
        ex_side = ex["side"]

        while qty_to_process > 1e-9 and lots and lots[0].side != ex_side:
            lot = lots[0]
            matched_qty = min(qty_to_process, lot.remaining)

            if lot.side == "BUY" and ex_side == "SELL":
                direction = "Long"
                gross_pnl = (ex["price"] - lot.price) * matched_qty
            elif lot.side == "SELL" and ex_side == "BUY":
                direction = "Short"
                gross_pnl = (lot.price - ex["price"]) * matched_qty
            else:
                direction = ""

            # Allocate commissions proportionally.
            entry_commission = lot.commission * matched_qty / lot.quantity if lot.quantity else 0
            exit_commission = ex["commission"] * matched_qty / ex["quantity"] if ex["quantity"] else 0

            # IBKR fifo_pnl_realized is generally on closing executions.
            # Use it if available; otherwise calculate approximate P&L from prices.
            ibkr_pnl_alloc = 0
            if abs(ex.get("fifo_pnl_realized", 0)) > 1e-9:
                ibkr_pnl_alloc = ex["fifo_pnl_realized"] * matched_qty / ex["quantity"]

            realized_pnl = ibkr_pnl_alloc if ibkr_pnl_alloc else gross_pnl - entry_commission - exit_commission

            closed_trades.append({
                "trade_id": f"{lot.trade_id}_{ex['trade_id']}_{len(closed_trades)+1}",
                "open_date": lot.date,
                "close_date": ex["date"],
                "symbol": ex["symbol"],
                "side": direction,
                "quantity": round(matched_qty, 6),
                "entry_price": round(lot.price, 6),
                "exit_price": round(ex["price"], 6),
                "currency": ex["currency"],
                "realized_pnl": round(realized_pnl, 2),
                "commission": round(entry_commission + exit_commission, 2),
                "strategy": "",
                "note": "",
                "entry_exec_id": lot.trade_id,
                "exit_exec_id": ex["trade_id"],
                "asset_class": ex.get("asset_class", ""),
            })

            lot.remaining -= matched_qty
            qty_to_process -= matched_qty

            if lot.remaining <= 1e-9:
                lots.popleft()

        if qty_to_process > 1e-9:
            lots.append(Lot(
                trade_id=ex["trade_id"],
                date=ex["date"],
                symbol=ex["symbol"],
                side=ex_side,
                quantity=ex["quantity"],
                remaining=qty_to_process,
                price=ex["price"],
                currency=ex["currency"],
                commission=ex["commission"] * qty_to_process / ex["quantity"] if ex["quantity"] else 0,
                raw=ex,
            ))

    open_trades = []
    for (symbol, currency), lots in lots_by_key.items():
        for lot in lots:
            open_trades.append({
                "trade_id": f"open_{lot.trade_id}",
                "open_date": lot.date,
                "close_date": "",
                "symbol": symbol,
                "side": "Long" if lot.side == "BUY" else "Short",
                "quantity": round(lot.remaining, 6),
                "entry_price": round(lot.price, 6),
                "exit_price": "",
                "currency": currency,
                "realized_pnl": 0,
                "commission": round(lot.commission, 2),
                "strategy": "",
                "note": "Open position",
                "entry_exec_id": lot.trade_id,
                "exit_exec_id": "",
                "asset_class": lot.raw.get("asset_class", ""),
            })

    closed_trades.sort(key=lambda x: (x["close_date"], x["symbol"], x["trade_id"]), reverse=True)
    open_trades.sort(key=lambda x: (x["open_date"], x["symbol"]), reverse=True)

    return closed_trades, open_trades


def main() -> int:
    token = os.environ.get("IBKR_FLEX_TOKEN")
    query_id = os.environ.get("IBKR_FLEX_QUERY_ID")

    if not token or not query_id:
        print("IBKR_FLEX_TOKEN or IBKR_FLEX_QUERY_ID missing. Keeping existing data.")
        return 0

    reference_code = request_flex_report(token, query_id)
    xml = get_flex_report(token, reference_code)

    executions = parse_executions(xml)
    closed_trades, open_trades = match_round_trips(executions)

    payload = {
        "last_updated": dt.datetime.utcnow().strftime("%Y-%m-%d %H:%M UTC"),
        "summary": {
            "executions_count": len(executions),
            "closed_trades_count": len(closed_trades),
            "open_trades_count": len(open_trades),
        },
        "trades": closed_trades + open_trades,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    print(
        f"Wrote {len(closed_trades)} closed trades and "
        f"{len(open_trades)} open trades from {len(executions)} executions to {OUTPUT}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
