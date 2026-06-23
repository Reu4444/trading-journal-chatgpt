let trades = [];
let filteredTrades = [];
let equityChart;
let tradeTags = {};
let spyPrices = {};
let currentPrices = {};

let stocksNotes = [];
let tradesNotes = [];

const NOTES_API_KEY = "notes-reuven-2026";

const NOTES_CONFIG = {
  stocks: {
    apiUrl: "https://script.google.com/macros/s/AKfycbyFb8m3rA4KfFTL5wVi3dIfuDojLvOIx0eO0D1oTii6nOGwfGc0annPCGOknF4-yX5c/exec",
    statusId: "stocksNotesStatus",
    listId: "stocksNotesList",
    searchId: "stocksNotesSearchInput",
    noteIdId: "stocksNoteId",
    titleId: "stocksNoteTitle",
    bodyId: "stocksNoteBody"
  },
  trades: {
    apiUrl: "https://script.google.com/macros/s/AKfycbxhJtxM47onAdzrM8CGo1O9WAxPsBMJgQGzc3ZN7KydjrktqDD-PXsB_Q3nmpDwkgID/exec",
    statusId: "tradesNotesStatus",
    listId: "tradesNotesList",
    searchId: "tradesNotesSearchInput",
    noteIdId: "tradesNoteId",
    titleId: "tradesNoteTitle",
    bodyId: "tradesNoteBody"
  }
};

let tableSort = {
  key: "close_date",
  direction: "desc"
};

let spySort = {
  key: "close_date",
  direction: "desc"
};

let ifKeptSort = {
  key: "difference_pct",
  direction: "desc"
};

let bestWorstSort = {
  best: {
    key: "realized_pnl",
    direction: "desc"
  },
  worst: {
    key: "realized_pnl",
    direction: "asc"
  }
};

const TAGS_STORAGE_KEY = "ibkrTradingJournalTags";

const fmtMoney = (value) => {
  return new Intl.NumberFormat("fr-CH", {
    maximumFractionDigits: 2
  }).format(value || 0);
};

const fmtPct = (value) => {
  if (value === "" || value === null || value === undefined || Number.isNaN(Number(value))) return "";

  return new Intl.NumberFormat("fr-CH", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  }).format(Number(value) / 100);
};

const fmtNumber = (value) => new Intl.NumberFormat("fr-CH").format(value || 0);

const fmtDate = (dateStr) => {
  if (!dateStr) return "";

  let clean = String(dateStr).trim();
  clean = clean.split(";")[0];

  if (/^\d{8}$/.test(clean)) {
    const yyyy = clean.slice(0, 4);
    const mm = clean.slice(4, 6);
    const dd = clean.slice(6, 8);
    return `${dd}-${mm}-${yyyy}`;
  }

  clean = clean.slice(0, 10);
  const parts = clean.split("-");

  if (parts.length === 3) {
    const [yyyy, mm, dd] = parts;
    return `${dd}-${mm}-${yyyy}`;
  }

  return dateStr;
};

function getSortableDate(dateStr) {
  if (!dateStr) return "";

  let clean = String(dateStr).trim();
  clean = clean.split(";")[0];

  if (/^\d{8}$/.test(clean)) {
    return `${clean.slice(0, 4)}-${clean.slice(4, 6)}-${clean.slice(6, 8)}`;
  }

  return clean.slice(0, 10);
}

function realizedPnl(trade) {
  return Number(trade.realized_pnl || 0);
}

function normalizeSymbol(symbol) {
  return String(symbol || "")
    .toUpperCase()
    .replaceAll("/", "")
    .replaceAll(".", "")
    .replaceAll("-", "")
    .replaceAll(" ", "")
    .trim();
}

function isFxTrade(trade) {
  const symbol = normalizeSymbol(trade.symbol);
  const assetClass = String(trade.asset_class || "").toUpperCase();

  return (
    symbol === "EURJPY" ||
    symbol.includes("EURJPY") ||
    assetClass === "CASH" ||
    assetClass === "FX" ||
    assetClass === "FOREX"
  );
}

function isExcludedTrade(trade) {
  const symbol = normalizeSymbol(trade.symbol);

  return (
    symbol === "META251031C00790000" ||
    symbol === "META251031C00795000"
  );
}

function cleanTrades(rawTrades) {
  const cleaned = (rawTrades || [])
    .filter(t => !isFxTrade(t))
    .filter(t => !isExcludedTrade(t))
    .filter(t => t.close_date);

  return aggregateSplitTrades(cleaned);
}

function aggregateSplitTrades(rows) {
  const grouped = {};

  rows.forEach(trade => {
    const key = [
      normalizeSymbol(trade.symbol),
      getSortableDate(trade.open_date),
      getSortableDate(trade.close_date),
      String(trade.side || "").toLowerCase()
    ].join("|");

    if (!grouped[key]) {
      grouped[key] = {
        ...trade,
        quantity: 0,
        realized_pnl: 0,
        commission: 0,
        entry_value: 0,
        exit_value: 0
      };
    }

    const qty = Math.abs(Number(trade.quantity || 0));
    const entry = Number(trade.entry_price || 0);
    const exit = Number(trade.exit_price || 0);

    grouped[key].quantity += qty;
    grouped[key].realized_pnl += Number(trade.realized_pnl || 0);
    grouped[key].commission += Number(trade.commission || 0);

    grouped[key].entry_value += qty * entry;
    grouped[key].exit_value += qty * exit;
  });

  return Object.values(grouped).map(trade => {
    if (trade.quantity > 0) {
      trade.entry_price = trade.entry_value / trade.quantity;
      trade.exit_price = trade.exit_value / trade.quantity;
    }

    delete trade.entry_value;
    delete trade.exit_value;

    return trade;
  });
}

function getTradeKey(trade) {
  return [
    normalizeSymbol(trade.symbol),
    getSortableDate(trade.open_date),
    getSortableDate(trade.close_date),
    String(trade.side || "").toLowerCase()
  ].join("|");
}

function loadTradeTags() {
  try {
    tradeTags = JSON.parse(localStorage.getItem(TAGS_STORAGE_KEY)) || {};
  } catch (error) {
    tradeTags = {};
  }
}

function saveTradeTags() {
  localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tradeTags));
}

function updateTradeTag(tradeKey, field, value) {
  if (!tradeTags[tradeKey]) {
    tradeTags[tradeKey] = {
      setup: "",
      mistake: ""
    };
  }

  tradeTags[tradeKey][field] = value;
  saveTradeTags();
  renderTagStats();
  renderSpyComparison();
}

function pnlPct(trade) {
  if (trade.pnl_pct !== undefined && trade.pnl_pct !== "") return Number(trade.pnl_pct);

  const entry = Number(trade.entry_price || 0);
  const exit = Number(trade.exit_price || 0);

  if (!entry || !exit) return "";

  if ((trade.side || "").toLowerCase() === "short") {
    return ((entry - exit) / entry) * 100;
  }

  return ((exit - entry) / entry) * 100;
}

function ifKeptPct(trade) {
  const current = getCurrentPrice(trade);
  const entry = Number(trade.entry_price || 0);

  if (!current || !entry) return "";

  if ((trade.side || "").toLowerCase() === "short") {
    return ((entry - current) / entry) * 100;
  }

  return ((current - entry) / entry) * 100;
}

function getDateFilters() {
  return {
    from: document.getElementById("dateFrom").value,
    to: document.getElementById("dateTo").value
  };
}

function applyDateFilter() {
  const { from, to } = getDateFilters();

  filteredTrades = trades.filter(trade => {
    const exitDate = getSortableDate(trade.close_date);

    if (!exitDate) return false;
    if (from && exitDate < from) return false;
    if (to && exitDate > to) return false;

    return true;
  });

  renderAll();
}

async function loadSpyPrices() {
  const status = document.getElementById("spyStatus");

  try {
    const response = await fetch("data/spy.json?ts=" + Date.now());

    if (!response.ok) {
      throw new Error("data/spy.json non disponible");
    }

    const payload = await response.json();
    spyPrices = payload.prices || {};

    if (status) {
      status.textContent =
        "Prix SPY chargés : " + (payload.last_updated || "—") + " — Source : " + (payload.source || "—");
    }
  } catch (error) {
    console.error(error);

    spyPrices = {};

    if (status) {
      status.textContent =
        "Prix SPY non disponibles. Vérifie que data/spy.json existe bien.";
    }
  }
}

async function loadCurrentPrices() {
  const status = document.getElementById("currentPriceStatus");

  try {
    const response = await fetch("data/current_prices.json?ts=" + Date.now());

    if (!response.ok) {
      throw new Error("data/current_prices.json non disponible");
    }

    const payload = await response.json();
    currentPrices = payload.prices || {};

    if (status) {
      status.textContent =
        "Prix actuels chargés : " + (payload.last_updated || "—") + " — Source : " + (payload.source || "—");
    }
  } catch (error) {
    console.error(error);

    currentPrices = {};

    if (status) {
      status.textContent =
        "Prix actuels non disponibles. Lance le workflow Update IBKR Trading Journal pour créer data/current_prices.json.";
    }
  }
}

function getCurrentPrice(trade) {
  const symbol = normalizeSymbol(trade.symbol);
  const item = currentPrices[symbol];

  if (!item || item.price === undefined || item.price === null) return null;

  return Number(item.price);
}

function getNearestSpyPrice(dateStr) {
  const date = getSortableDate(dateStr);
  if (!date) return null;

  if (spyPrices[date]) {
    return spyPrices[date];
  }

  const dates = Object.keys(spyPrices).sort();
  let nearest = null;

  for (const spyDate of dates) {
    if (spyDate <= date) {
      nearest = spyDate;
    } else {
      break;
    }
  }

  return nearest ? spyPrices[nearest] : null;
}

function getLatestSpyPrice() {
  const dates = Object.keys(spyPrices).sort();

  if (!dates.length) return null;

  return spyPrices[dates[dates.length - 1]];
}

function getSpyPctForTrade(trade) {
  const entrySpy = getNearestSpyPrice(trade.open_date);
  const exitSpy = getNearestSpyPrice(trade.close_date);

  if (!entrySpy || !exitSpy) return "";

  return ((exitSpy - entrySpy) / entrySpy) * 100;
}

function getSpyIfKeptPct(trade) {
  const entrySpy = getNearestSpyPrice(trade.open_date);
  const latestSpy = getLatestSpyPrice();

  if (!entrySpy || !latestSpy) return "";

  return ((latestSpy - entrySpy) / entrySpy) * 100;
}

async function loadTrades() {
  loadTradeTags();

  const response = await fetch("data/trades.json?ts=" + Date.now());
  const payload = await response.json();

  trades = cleanTrades(payload.trades);
  filteredTrades = trades;

  document.getElementById("lastUpdated").textContent =
    "Dernière mise à jour : " + (payload.last_updated || "—");

  await loadSpyPrices();
  await loadCurrentPrices();

  renderAll();
}

function computeStats(rows) {
  const totalPnl = rows.reduce((sum, t) => sum + realizedPnl(t), 0);
  const winners = rows.filter(t => realizedPnl(t) > 0);
  const losers = rows.filter(t => realizedPnl(t) < 0);

  const grossProfit = winners.reduce((sum, t) => sum + realizedPnl(t), 0);
  const grossLoss = Math.abs(losers.reduce((sum, t) => sum + realizedPnl(t), 0));

  const avgWinUsd = winners.length ? grossProfit / winners.length : 0;
  const avgLossUsd = losers.length ? -grossLoss / losers.length : 0;

  const avgWinPct = winners.length
    ? winners.reduce((sum, t) => sum + Number(pnlPct(t) || 0), 0) / winners.length
    : 0;

  const avgLossPct = losers.length
    ? losers.reduce((sum, t) => sum + Number(pnlPct(t) || 0), 0) / losers.length
    : 0;

  const winRate = rows.length ? winners.length / rows.length : 0;
  const profitFactor = grossLoss ? grossProfit / grossLoss : null;

  const avgWinLossRatio =
    avgLossUsd !== 0 ? avgWinUsd / Math.abs(avgLossUsd) : null;

  return {
    totalPnl,
    tradeCount: rows.length,
    winRate,
    avgWinUsd,
    avgLossUsd,
    avgWinPct,
    avgLossPct,
    profitFactor,
    avgWinLossRatio
  };
}

function renderStatistics() {
  const stats = computeStats(filteredTrades);

  document.getElementById("statsTotalPnl").textContent = fmtMoney(stats.totalPnl);
  document.getElementById("statsTradeCount").textContent = fmtNumber(stats.tradeCount);

  document.getElementById("statsProfitFactor").textContent =
    stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2);

  document.getElementById("statsWinRate").textContent =
    Math.round(stats.winRate * 100) + "%";

  document.getElementById("statsAvgWinPct").textContent = fmtPct(stats.avgWinPct);
  document.getElementById("statsAvgLossPct").textContent = fmtPct(stats.avgLossPct);
  document.getElementById("statsAvgWinUsd").textContent = fmtMoney(stats.avgWinUsd);
  document.getElementById("statsAvgLossUsd").textContent = fmtMoney(stats.avgLossUsd);

  document.getElementById("statsAvgWinLossRatio").textContent =
    stats.avgWinLossRatio === null ? "—" : stats.avgWinLossRatio.toFixed(2);
}

function renderStatsCells(stats) {
  return `
    <td class="${stats.totalPnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(stats.totalPnl)}</td>
    <td>${fmtNumber(stats.tradeCount)}</td>
    <td>${stats.profitFactor === null ? "—" : stats.profitFactor.toFixed(2)}</td>
    <td>${stats.tradeCount ? Math.round(stats.winRate * 100) + "%" : "—"}</td>
    <td>${fmtPct(stats.avgWinPct)}</td>
    <td>${fmtPct(stats.avgLossPct)}</td>
    <td>${fmtMoney(stats.avgWinUsd)}</td>
    <td>${fmtMoney(stats.avgLossUsd)}</td>
    <td>${stats.avgWinLossRatio === null ? "—" : stats.avgWinLossRatio.toFixed(2)}</td>
  `;
}

function getSortValue(trade, key) {
  if (key === "open_date") return getSortableDate(trade.open_date);
  if (key === "close_date") return getSortableDate(trade.close_date);
  if (key === "symbol") return String(trade.symbol || "").toUpperCase();
  if (key === "quantity") return Number(trade.quantity || 0);
  if (key === "entry_price") return Number(trade.entry_price || 0);
  if (key === "exit_price") return Number(trade.exit_price || 0);
  if (key === "realized_pnl") return realizedPnl(trade);
  if (key === "pnl_pct") return Number(pnlPct(trade) || 0);

  return "";
}

function sortTrades(rows) {
  return rows.slice().sort((a, b) => {
    const aValue = getSortValue(a, tableSort.key);
    const bValue = getSortValue(b, tableSort.key);

    if (typeof aValue === "number" && typeof bValue === "number") {
      return tableSort.direction === "asc"
        ? aValue - bValue
        : bValue - aValue;
    }

    return tableSort.direction === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
}

function sortBestWorstRows(rows, tableType) {
  const currentSort = bestWorstSort[tableType];

  return rows.slice().sort((a, b) => {
    const aValue = getSortValue(a, currentSort.key);
    const bValue = getSortValue(b, currentSort.key);

    if (typeof aValue === "number" && typeof bValue === "number") {
      return currentSort.direction === "asc"
        ? aValue - bValue
        : bValue - aValue;
    }

    return currentSort.direction === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
}

function getSpySortValue(trade, key) {
  const tradeKey = getTradeKey(trade);
  const tags = tradeTags[tradeKey] || { setup: "", mistake: "" };

  const tradePct = pnlPct(trade);
  const spyPct = getSpyPctForTrade(trade);

  const alpha =
    tradePct === "" || spyPct === ""
      ? ""
      : Number(tradePct) - Number(spyPct);

  if (key === "open_date") return getSortableDate(trade.open_date);
  if (key === "close_date") return getSortableDate(trade.close_date);
  if (key === "symbol") return String(trade.symbol || "").toUpperCase();
  if (key === "realized_pnl") return realizedPnl(trade);
  if (key === "trade_pct") return tradePct === "" ? null : Number(tradePct);
  if (key === "spy_pct") return spyPct === "" ? null : Number(spyPct);
  if (key === "alpha") return alpha === "" ? null : Number(alpha);
  if (key === "setup") return String(tags.setup || "").toUpperCase();
  if (key === "mistake") return String(tags.mistake || "").toUpperCase();

  return "";
}

function sortSpyComparisonRows(rows) {
  return rows.slice().sort((a, b) => {
    const aValue = getSpySortValue(a, spySort.key);
    const bValue = getSpySortValue(b, spySort.key);

    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    if (typeof aValue === "number" && typeof bValue === "number") {
      return spySort.direction === "asc"
        ? aValue - bValue
        : bValue - aValue;
    }

    return spySort.direction === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
}

function getIfKeptSortValue(trade, key) {
  const tradePct = pnlPct(trade);
  const keptPct = ifKeptPct(trade);

  const difference =
    tradePct === "" || keptPct === ""
      ? ""
      : Number(keptPct) - Number(tradePct);

  const spyKeptPct = getSpyIfKeptPct(trade);

  const alpha =
    keptPct === "" || spyKeptPct === ""
      ? ""
      : Number(keptPct) - Number(spyKeptPct);

  if (key === "open_date") return getSortableDate(trade.open_date);
  if (key === "close_date") return getSortableDate(trade.close_date);
  if (key === "symbol") return String(trade.symbol || "").toUpperCase();
  if (key === "trade_pct") return tradePct === "" ? null : Number(tradePct);
  if (key === "if_kept_pct") return keptPct === "" ? null : Number(keptPct);
  if (key === "difference_pct") return difference === "" ? null : Number(difference);
  if (key === "spy_if_kept_pct") return spyKeptPct === "" ? null : Number(spyKeptPct);
  if (key === "alpha_if_kept_spy") return alpha === "" ? null : Number(alpha);

  return "";
}

function sortIfKeptRows(rows) {
  return rows.slice().sort((a, b) => {
    const aValue = getIfKeptSortValue(a, ifKeptSort.key);
    const bValue = getIfKeptSortValue(b, ifKeptSort.key);

    if (aValue === null && bValue === null) return 0;
    if (aValue === null) return 1;
    if (bValue === null) return -1;

    if (typeof aValue === "number" && typeof bValue === "number") {
      return ifKeptSort.direction === "asc"
        ? aValue - bValue
        : bValue - aValue;
    }

    return ifKeptSort.direction === "asc"
      ? String(aValue).localeCompare(String(bValue))
      : String(bValue).localeCompare(String(aValue));
  });
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderTable(rows) {
  const tbody = document.getElementById("tradeTable");
  tbody.innerHTML = "";

  sortTrades(rows).forEach(trade => {
    const pnl = realizedPnl(trade);
    const pct = pnlPct(trade);
    const tradeKey = getTradeKey(trade);
    const tags = tradeTags[tradeKey] || { setup: "", mistake: "" };

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(trade.open_date)}</td>
      <td>${fmtDate(trade.close_date)}</td>
      <td><strong>${trade.symbol || ""}</strong></td>
      <td>${fmtNumber(trade.quantity)}</td>
      <td>${Number(trade.entry_price || 0).toFixed(2)}</td>
      <td>${Number(trade.exit_price || 0).toFixed(2)}</td>
      <td class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl)}</td>
      <td class="${pct === "" ? "" : pct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(pct)}</td>
      <td>
        <input
          class="tag-input"
          list="setupTags"
          data-trade-key="${tradeKey}"
          data-tag-field="setup"
          value="${escapeHtml(tags.setup)}"
          placeholder="Set up"
        />
      </td>
      <td>
        <input
          class="tag-input"
          list="mistakeTags"
          data-trade-key="${tradeKey}"
          data-tag-field="mistake"
          value="${escapeHtml(tags.mistake)}"
          placeholder="Mistake"
        />
      </td>
    `;

    tbody.appendChild(tr);
  });

  bindTagInputs();
}

function bindTagInputs() {
  document.querySelectorAll(".tag-input").forEach(input => {
    input.addEventListener("input", event => {
      const tradeKey = event.target.dataset.tradeKey;
      const field = event.target.dataset.tagField;
      const value = event.target.value;

      updateTradeTag(tradeKey, field, value);
    });
  });
}

function renderTradeRows(tableId, rows, tableType = null) {
  const tbody = document.getElementById(tableId);
  if (!tbody) return;

  tbody.innerHTML = "";

  const displayRows = tableType
    ? sortBestWorstRows(rows, tableType)
    : rows.slice().sort((a, b) => new Date(getSortableDate(b.close_date)) - new Date(getSortableDate(a.close_date)));

  displayRows.forEach(trade => {
    const pnl = realizedPnl(trade);
    const pct = pnlPct(trade);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(trade.open_date)}</td>
      <td>${fmtDate(trade.close_date)}</td>
      <td><strong>${trade.symbol || ""}</strong></td>
      <td>${fmtNumber(trade.quantity)}</td>
      <td>${Number(trade.entry_price || 0).toFixed(2)}</td>
      <td>${Number(trade.exit_price || 0).toFixed(2)}</td>
      <td class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl)}</td>
      <td class="${pct === "" ? "" : pct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(pct)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderIfKept() {
  const tbody = document.getElementById("ifKeptTable");
  if (!tbody) return;

  tbody.innerHTML = "";

  const losingTrades = filteredTrades.filter(trade => {
    const side = String(trade.side || "").toLowerCase();
    return realizedPnl(trade) < 0 && side !== "short";
  });

  if (!losingTrades.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="8">Aucun trade perdant pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  sortIfKeptRows(losingTrades).forEach(trade => {
    const tradePct = pnlPct(trade);
    const keptPct = ifKeptPct(trade);

    const difference =
      tradePct === "" || keptPct === ""
        ? ""
        : Number(keptPct) - Number(tradePct);

    const spyKeptPct = getSpyIfKeptPct(trade);

    const alpha =
      keptPct === "" || spyKeptPct === ""
        ? ""
        : Number(keptPct) - Number(spyKeptPct);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(trade.open_date)}</td>
      <td>${fmtDate(trade.close_date)}</td>
      <td><strong>${trade.symbol || ""}</strong></td>
      <td class="${tradePct === "" ? "" : tradePct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(tradePct)}</td>
      <td class="${keptPct === "" ? "" : keptPct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(keptPct)}</td>
      <td class="${difference === "" ? "" : difference >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(difference)}</td>
      <td class="${spyKeptPct === "" ? "" : spyKeptPct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(spyKeptPct)}</td>
      <td class="${alpha === "" ? "" : alpha >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(alpha)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderSpyComparison() {
  const tbody = document.getElementById("spyComparisonTable");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (!filteredTrades.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="9">Aucun trade pour cette période.</td>`;
    tbody.appendChild(tr);
    return;
  }

  sortSpyComparisonRows(filteredTrades).forEach(trade => {
    const tradeKey = getTradeKey(trade);
    const tags = tradeTags[tradeKey] || { setup: "", mistake: "" };

    const pnl = realizedPnl(trade);
    const tradePct = pnlPct(trade);
    const spyPct = getSpyPctForTrade(trade);

    const alpha =
      tradePct === "" || spyPct === ""
        ? ""
        : Number(tradePct) - Number(spyPct);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${fmtDate(trade.open_date)}</td>
      <td>${fmtDate(trade.close_date)}</td>
      <td><strong>${trade.symbol || ""}</strong></td>
      <td class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl)}</td>
      <td class="${tradePct === "" ? "" : tradePct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(tradePct)}</td>
      <td class="${spyPct === "" ? "" : spyPct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(spyPct)}</td>
      <td class="${alpha === "" ? "" : alpha >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(alpha)}</td>
      <td>${escapeHtml(tags.setup)}</td>
      <td>${escapeHtml(tags.mistake)}</td>
    `;

    tbody.appendChild(tr);
  });
}

function renderEquityChart() {
  const daily = {};

  filteredTrades.forEach(t => {
    const date = getSortableDate(t.close_date);
    if (!date) return;
    daily[date] = (daily[date] || 0) + realizedPnl(t);
  });

  const labels = Object.keys(daily).sort();
  let cumulative = 0;

  const values = labels.map(date => {
    cumulative += daily[date];
    return Number(cumulative.toFixed(2));
  });

  const ctx = document.getElementById("equityChart");

  if (!ctx) return;
  if (equityChart) equityChart.destroy();

  equityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels.map(fmtDate),
      datasets: [{
        label: "P&L cumulé",
        data: values,
        tension: 0.25,
        borderWidth: 2,
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          ticks: {
            callback: value => fmtMoney(value)
          }
        }
      }
    }
  });
}

function getMonthKey(dateStr) {
  const clean = getSortableDate(dateStr);
  if (!clean) return "";

  return clean.slice(0, 7);
}

function fmtMonth(monthKey) {
  if (!monthKey || monthKey.length !== 7) return monthKey;

  const [yyyy, mm] = monthKey.split("-");
  return `${mm}-${yyyy}`;
}

function renderMonthlyStats() {
  const tbody = document.getElementById("monthlyStatsTable");
  if (!tbody) return;

  tbody.innerHTML = "";

  const grouped = {};

  trades.forEach(trade => {
    const monthKey = getMonthKey(trade.close_date);
    if (!monthKey) return;

    if (!grouped[monthKey]) {
      grouped[monthKey] = [];
    }

    grouped[monthKey].push(trade);
  });

  const months = Object.keys(grouped).sort().reverse();

  months.forEach(monthKey => {
    const rows = grouped[monthKey];
    const stats = computeStats(rows);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${fmtMonth(monthKey)}</strong></td>
      ${renderStatsCells(stats)}
    `;

    tbody.appendChild(tr);
  });
}

function renderGroupedTagStats(tableId, tagField) {
  const tbody = document.getElementById(tableId);
  if (!tbody) return;

  tbody.innerHTML = "";

  const grouped = {};

  filteredTrades.forEach(trade => {
    const tradeKey = getTradeKey(trade);
    const tagValue = String(tradeTags[tradeKey]?.[tagField] || "").trim();

    if (!tagValue) return;

    if (!grouped[tagValue]) {
      grouped[tagValue] = [];
    }

    grouped[tagValue].push(trade);
  });

  const tags = Object.keys(grouped).sort((a, b) => {
    const pnlA = computeStats(grouped[a]).totalPnl;
    const pnlB = computeStats(grouped[b]).totalPnl;
    return pnlB - pnlA;
  });

  if (!tags.length) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td colspan="10">Aucun tag renseigné pour cette période.</td>
    `;
    tbody.appendChild(tr);
    return;
  }

  tags.forEach(tag => {
    const stats = computeStats(grouped[tag]);
    const tr = document.createElement("tr");

    tr.innerHTML = `
      <td><strong>${escapeHtml(tag)}</strong></td>
      ${renderStatsCells(stats)}
    `;

    tbody.appendChild(tr);
  });
}

function renderTagStats() {
  renderGroupedTagStats("setupStatsTable", "setup");
  renderGroupedTagStats("mistakeStatsTable", "mistake");
}

function renderBestWorstTrades() {
  const closedTrades = trades.filter(t => t.close_date);
  const count = Math.max(1, Math.ceil(closedTrades.length * 0.2));

  const bestTrades = closedTrades
    .slice()
    .sort((a, b) => realizedPnl(b) - realizedPnl(a))
    .slice(0, count);

  const worstTrades = closedTrades
    .slice()
    .sort((a, b) => realizedPnl(a) - realizedPnl(b))
    .slice(0, count);

  renderTradeRows("bestTradesTable", bestTrades, "best");
  renderTradeRows("worstTradesTable", worstTrades, "worst");
}

function renderAll() {
  renderStatistics();
  renderTable(filteredTrades);
  renderEquityChart();
  renderMonthlyStats();
  renderTagStats();
  renderBestWorstTrades();
  renderIfKept();
  renderSpyComparison();
}

function getNotesArray(noteType) {
  return noteType === "stocks" ? stocksNotes : tradesNotes;
}

function setNotesArray(noteType, value) {
  if (noteType === "stocks") {
    stocksNotes = value;
  } else {
    tradesNotes = value;
  }
}

function notesJsonp(noteType, params) {
  return new Promise((resolve, reject) => {
    const config = NOTES_CONFIG[noteType];
    const callbackName = "notesCallback_" + noteType + "_" + Date.now() + "_" + Math.floor(Math.random() * 100000);

    params.key = NOTES_API_KEY;
    params.callback = callbackName;

    const url = config.apiUrl + "?" + new URLSearchParams(params).toString();

    const script = document.createElement("script");
    script.src = url;

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Notes API timeout"));
    }, 15000);

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Notes API error"));
    };

    document.body.appendChild(script);
  });
}

async function loadNotes(noteType) {
  const config = NOTES_CONFIG[noteType];
  const status = document.getElementById(config.statusId);
  const list = document.getElementById(config.listId);

  if (!status || !list) return;

  status.textContent = "Chargement des notes…";

  try {
    const response = await notesJsonp(noteType, {
      action: "list"
    });

    if (!response.ok) {
      throw new Error(response.error || "Erreur notes");
    }

    setNotesArray(noteType, response.notes || []);
    renderNotesList(noteType);

    status.textContent = "Notes chargées depuis Google Sheet.";
  } catch (error) {
    console.error(error);
    status.textContent = "Erreur de chargement des notes.";
  }
}

function renderNotesList(noteType) {
  const config = NOTES_CONFIG[noteType];
  const list = document.getElementById(config.listId);
  const searchInput = document.getElementById(config.searchId);

  if (!list) return;

  const currentNotes = getNotesArray(noteType);
  const q = searchInput ? searchInput.value.toLowerCase().trim() : "";

  const visibleNotes = currentNotes.filter(note => {
    const searchable = [
      note.title,
      note.note,
      note.created_at,
      note.updated_at
    ].join(" ").toLowerCase();

    return searchable.includes(q);
  });

  list.innerHTML = "";

  if (!visibleNotes.length) {
    list.innerHTML = `<p class="empty-notes">Aucune note trouvée.</p>`;
    return;
  }

  visibleNotes.forEach(note => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "note-item";
    item.innerHTML = `
      <strong>${escapeHtml(note.title || "Sans titre")}</strong>
      <span>${escapeHtml(note.updated_at || "")}</span>
    `;

    item.addEventListener("click", () => {
      document.getElementById(config.noteIdId).value = note.id || "";
      document.getElementById(config.titleId).value = note.title || "";
      document.getElementById(config.bodyId).value = note.note || "";
      document.getElementById(config.statusId).textContent = "Note chargée.";
    });

    list.appendChild(item);
  });
}

function clearNoteForm(noteType) {
  const config = NOTES_CONFIG[noteType];

  document.getElementById(config.noteIdId).value = "";
  document.getElementById(config.titleId).value = "";
  document.getElementById(config.bodyId).value = "";
  document.getElementById(config.statusId).textContent = "Nouvelle note.";
}

async function saveCurrentNote(noteType) {
  const config = NOTES_CONFIG[noteType];

  const status = document.getElementById(config.statusId);
  const id = document.getElementById(config.noteIdId).value;
  const title = document.getElementById(config.titleId).value.trim();
  const note = document.getElementById(config.bodyId).value.trim();

  if (!title && !note) {
    status.textContent = "Impossible de sauvegarder une note vide.";
    return;
  }

  status.textContent = "Sauvegarde…";

  try {
    const response = await notesJsonp(noteType, {
      action: "save",
      id: id,
      title: title,
      note: note
    });

    if (!response.ok) {
      throw new Error(response.error || "Erreur sauvegarde");
    }

    document.getElementById(config.noteIdId).value = response.id || "";
    status.textContent = "Note sauvegardée.";

    await loadNotes(noteType);
  } catch (error) {
    console.error(error);
    status.textContent = "Erreur pendant la sauvegarde.";
  }
}

async function deleteCurrentNote(noteType) {
  const config = NOTES_CONFIG[noteType];

  const status = document.getElementById(config.statusId);
  const id = document.getElementById(config.noteIdId).value;

  if (!id) {
    status.textContent = "Aucune note sélectionnée.";
    return;
  }

  const confirmed = window.confirm("Supprimer cette note ?");
  if (!confirmed) return;

  status.textContent = "Suppression…";

  try {
    const response = await notesJsonp(noteType, {
      action: "delete",
      id: id
    });

    if (!response.ok) {
      throw new Error(response.error || "Erreur suppression");
    }

    clearNoteForm(noteType);
    status.textContent = "Note supprimée.";

    await loadNotes(noteType);
  } catch (error) {
    console.error(error);
    status.textContent = "Erreur pendant la suppression.";
  }
}

document.getElementById("searchInput").addEventListener("input", event => {
  const q = event.target.value.toLowerCase().trim();

  const searched = filteredTrades.filter(t => {
    return [
      t.symbol,
      t.side,
      t.quantity,
      t.entry_price,
      t.exit_price,
      t.realized_pnl,
      t.pnl_pct,
      t.close_date,
      t.open_date,
      tradeTags[getTradeKey(t)]?.setup,
      tradeTags[getTradeKey(t)]?.mistake
    ].join(" ").toLowerCase().includes(q);
  });

  renderTable(searched);
});

document.getElementById("dateFrom").addEventListener("change", applyDateFilter);
document.getElementById("dateTo").addEventListener("change", applyDateFilter);

document.getElementById("resetFilters").addEventListener("click", () => {
  document.getElementById("dateFrom").value = "";
  document.getElementById("dateTo").value = "";
  document.getElementById("searchInput").value = "";
  filteredTrades = trades;
  renderAll();
});

document.querySelectorAll("#journalTab th[data-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.sort;

    if (tableSort.key === key) {
      tableSort.direction = tableSort.direction === "desc" ? "asc" : "desc";
    } else {
      tableSort.key = key;

      if (
        key === "realized_pnl" ||
        key === "pnl_pct" ||
        key === "quantity" ||
        key === "entry_price" ||
        key === "exit_price" ||
        key === "close_date" ||
        key === "open_date"
      ) {
        tableSort.direction = "desc";
      } else {
        tableSort.direction = "asc";
      }
    }

    renderTable(filteredTrades);
  });
});

document.querySelectorAll("#bestWorstTab th[data-bw-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const tableType = th.dataset.bwTable;
    const key = th.dataset.bwSort;

    if (!bestWorstSort[tableType]) return;

    if (bestWorstSort[tableType].key === key) {
      bestWorstSort[tableType].direction =
        bestWorstSort[tableType].direction === "desc" ? "asc" : "desc";
    } else {
      bestWorstSort[tableType].key = key;

      if (
        key === "realized_pnl" ||
        key === "pnl_pct" ||
        key === "quantity" ||
        key === "entry_price" ||
        key === "exit_price" ||
        key === "close_date" ||
        key === "open_date"
      ) {
        bestWorstSort[tableType].direction = "desc";
      } else {
        bestWorstSort[tableType].direction = "asc";
      }
    }

    renderBestWorstTrades();
  });
});

document.querySelectorAll("#ifKeptTab th[data-ifkept-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.ifkeptSort;

    if (ifKeptSort.key === key) {
      ifKeptSort.direction = ifKeptSort.direction === "desc" ? "asc" : "desc";
    } else {
      ifKeptSort.key = key;

      if (
        key === "trade_pct" ||
        key === "if_kept_pct" ||
        key === "difference_pct" ||
        key === "spy_if_kept_pct" ||
        key === "alpha_if_kept_spy" ||
        key === "close_date" ||
        key === "open_date"
      ) {
        ifKeptSort.direction = "desc";
      } else {
        ifKeptSort.direction = "asc";
      }
    }

    renderIfKept();
  });
});

document.querySelectorAll("#spyTab th[data-spy-sort]").forEach(th => {
  th.addEventListener("click", () => {
    const key = th.dataset.spySort;

    if (spySort.key === key) {
      spySort.direction = spySort.direction === "desc" ? "asc" : "desc";
    } else {
      spySort.key = key;

      if (
        key === "realized_pnl" ||
        key === "trade_pct" ||
        key === "spy_pct" ||
        key === "alpha" ||
        key === "close_date" ||
        key === "open_date"
      ) {
        spySort.direction = "desc";
      } else {
        spySort.direction = "asc";
      }
    }

    renderSpyComparison();
  });
});

document.querySelectorAll(".tab-button").forEach(button => {
  button.addEventListener("click", () => {
    const tab = button.dataset.tab;

    document.querySelectorAll(".tab-button").forEach(btn => btn.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach(section => section.classList.remove("active"));

    button.classList.add("active");

    if (tab === "journal") {
      document.getElementById("journalTab").classList.add("active");
    }

    if (tab === "statistics") {
      document.getElementById("statisticsTab").classList.add("active");
      setTimeout(() => {
        if (equityChart) equityChart.resize();
      }, 50);
    }

    if (tab === "bestworst") {
      document.getElementById("bestWorstTab").classList.add("active");
    }

    if (tab === "ifkept") {
      document.getElementById("ifKeptTab").classList.add("active");
    }

    if (tab === "spy") {
      document.getElementById("spyTab").classList.add("active");
    }

    if (tab === "notesstocks") {
      document.getElementById("notesStocksTab").classList.add("active");
      loadNotes("stocks");
    }

    if (tab === "notestrades") {
      document.getElementById("notesTradesTab").classList.add("active");
      loadNotes("trades");
    }
  });
});

const stocksNewNoteButton = document.getElementById("stocksNewNoteButton");
const stocksSaveNoteButton = document.getElementById("stocksSaveNoteButton");
const stocksDeleteNoteButton = document.getElementById("stocksDeleteNoteButton");
const stocksNotesSearchInput = document.getElementById("stocksNotesSearchInput");

if (stocksNewNoteButton) {
  stocksNewNoteButton.addEventListener("click", () => clearNoteForm("stocks"));
}

if (stocksSaveNoteButton) {
  stocksSaveNoteButton.addEventListener("click", () => saveCurrentNote("stocks"));
}

if (stocksDeleteNoteButton) {
  stocksDeleteNoteButton.addEventListener("click", () => deleteCurrentNote("stocks"));
}

if (stocksNotesSearchInput) {
  stocksNotesSearchInput.addEventListener("input", () => renderNotesList("stocks"));
}

const tradesNewNoteButton = document.getElementById("tradesNewNoteButton");
const tradesSaveNoteButton = document.getElementById("tradesSaveNoteButton");
const tradesDeleteNoteButton = document.getElementById("tradesDeleteNoteButton");
const tradesNotesSearchInput = document.getElementById("tradesNotesSearchInput");

if (tradesNewNoteButton) {
  tradesNewNoteButton.addEventListener("click", () => clearNoteForm("trades"));
}

if (tradesSaveNoteButton) {
  tradesSaveNoteButton.addEventListener("click", () => saveCurrentNote("trades"));
}

if (tradesDeleteNoteButton) {
  tradesDeleteNoteButton.addEventListener("click", () => deleteCurrentNote("trades"));
}

if (tradesNotesSearchInput) {
  tradesNotesSearchInput.addEventListener("input", () => renderNotesList("trades"));
}

loadTrades().catch(error => {
  console.error(error);
  document.getElementById("lastUpdated").textContent = "Erreur de chargement des données";
});
