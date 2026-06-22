let trades = [];
let chart;

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

  const clean = String(dateStr).slice(0, 10);
  const parts = clean.split("-");

  if (parts.length !== 3) return dateStr;

  const [yyyy, mm, dd] = parts;
  return `${dd}-${mm}-${yyyy}`;
};

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

function cleanTrades(rawTrades) {
  return (rawTrades || []).filter(t => !isFxTrade(t));
}

async function loadTrades() {
  const response = await fetch("data/trades.json?ts=" + Date.now());
  const payload = await response.json();

  trades = cleanTrades(payload.trades);

  document.getElementById("lastUpdated").textContent =
    "Dernière mise à jour : " + (payload.last_updated || "—");

  renderDashboard();
  renderTable(trades);
  renderStats();
  renderChart();
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

function renderDashboard() {
  const closedTrades = trades.filter(t => t.close_date);
  const total = closedTrades.reduce((sum, t) => sum + realizedPnl(t), 0);

  const winners = closedTrades.filter(t => realizedPnl(t) > 0);
  const losers = closedTrades.filter(t => realizedPnl(t) < 0);
  const winRate = closedTrades.length ? winners.length / closedTrades.length : 0;

  const avgWin = winners.length
    ? winners.reduce((sum, t) => sum + realizedPnl(t), 0) / winners.length
    : 0;

  const avgLoss = losers.length
    ? losers.reduce((sum, t) => sum + realizedPnl(t), 0) / losers.length
    : 0;

  document.getElementById("totalPnl").textContent = fmtMoney(total);
  document.getElementById("tradeCount").textContent = fmtNumber(closedTrades.length);
  document.getElementById("winRate").textContent = Math.round(winRate * 100) + "%";
  document.getElementById("avgWinLoss").textContent =
    fmtMoney(avgWin) + " / " + fmtMoney(avgLoss);
}

function renderTable(rows) {
  const tbody = document.getElementById("tradeTable");
  tbody.innerHTML = "";

  rows
    .filter(t => t.close_date)
    .slice()
    .sort((a, b) => new Date(b.close_date || b.open_date) - new Date(a.close_date || a.open_date))
    .forEach(trade => {
      const pnl = realizedPnl(trade);
      const pct = pnlPct(trade);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${fmtDate(trade.open_date)}</td>
        <td>${fmtDate(trade.close_date)}</td>
        <td><strong>${trade.symbol || ""}</strong></td>
        <td>${fmtNumber(trade.quantity)}</td>
        <td>${trade.entry_price ?? ""}</td>
        <td>${trade.exit_price ?? ""}</td>
        <td class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl)}</td>
        <td class="${pct === "" ? "" : pct >= 0 ? "pnl-good" : "pnl-bad"}">${fmtPct(pct)}</td>
      `;
      tbody.appendChild(tr);
    });
}

function groupPnlBy(key) {
  const map = {};

  trades
    .filter(t => t.close_date)
    .forEach(t => {
      const label = t[key] || "Non classé";
      map[label] = (map[label] || 0) + realizedPnl(t);
    });

  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}

function renderStatList(containerId, rows) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  rows.forEach(([label, pnl]) => {
    const row = document.createElement("div");
    row.className = "stat-row";
    row.innerHTML = `
      <span>${label}</span>
      <strong class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl)}</strong>
    `;
    container.appendChild(row);
  });
}

function renderStats() {
  renderStatList("strategyStats", groupPnlBy("strategy"));
  renderStatList("tickerStats", groupPnlBy("symbol"));
}

function renderChart() {
  const daily = {};

  trades
    .filter(t => t.close_date)
    .forEach(t => {
      const date = t.close_date;
      if (!date) return;
      daily[date] = (daily[date] || 0) + realizedPnl(t);
    });

  const labels = Object.keys(daily).sort();
  let cumulative = 0;
  const values = labels.map(date => {
    cumulative += daily[date];
    return Math.round(cumulative);
  });

  const ctx = document.getElementById("equityChart");

  if (chart) chart.destroy();

  chart = new Chart(ctx, {
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

document.getElementById("searchInput").addEventListener("input", event => {
  const q = event.target.value.toLowerCase().trim();

  const filtered = trades.filter(t => {
    return [
      t.symbol,
      t.side,
      t.quantity,
      t.entry_price,
      t.exit_price,
      t.realized_pnl,
      t.pnl_pct,
      t.close_date,
      t.open_date
    ].join(" ").toLowerCase().includes(q);
  });

  renderTable(filtered);
});

loadTrades().catch(error => {
  console.error(error);
  document.getElementById("lastUpdated").textContent = "Erreur de chargement des données";
});
