let trades = [];
let chart;

const fmtMoney = (value, currency = "USD") => {
  return new Intl.NumberFormat("fr-CH", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value || 0);
};

const fmtNumber = (value) => new Intl.NumberFormat("fr-CH").format(value || 0);

async function loadTrades() {
  const response = await fetch("data/trades.json?ts=" + Date.now());
  const payload = await response.json();
  trades = payload.trades || [];

  document.getElementById("lastUpdated").textContent =
    "Dernière mise à jour : " + (payload.last_updated || "—");

  renderDashboard();
  renderTable(trades);
  renderStats();
  renderChart();
}

function realizedPnl(trade) {
  return Number(trade.realized_pnl || 0);
}

function renderDashboard() {
  const total = trades.reduce((sum, t) => sum + realizedPnl(t), 0);
  const winners = trades.filter(t => realizedPnl(t) > 0);
  const losers = trades.filter(t => realizedPnl(t) < 0);
  const winRate = trades.length ? winners.length / trades.length : 0;

  const avgWin = winners.length
    ? winners.reduce((sum, t) => sum + realizedPnl(t), 0) / winners.length
    : 0;

  const avgLoss = losers.length
    ? losers.reduce((sum, t) => sum + realizedPnl(t), 0) / losers.length
    : 0;

  document.getElementById("totalPnl").textContent = fmtMoney(total);
  document.getElementById("tradeCount").textContent = fmtNumber(trades.length);
  document.getElementById("winRate").textContent = Math.round(winRate * 100) + "%";
  document.getElementById("avgWinLoss").textContent =
    fmtMoney(avgWin) + " / " + fmtMoney(avgLoss);
}

function renderTable(rows) {
  const tbody = document.getElementById("tradeTable");
  tbody.innerHTML = "";

  rows
    .slice()
    .sort((a, b) => new Date(b.close_date || b.open_date) - new Date(a.close_date || a.open_date))
    .forEach(trade => {
      const pnl = realizedPnl(trade);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${trade.close_date || trade.open_date || ""}</td>
        <td><strong>${trade.symbol || ""}</strong></td>
        <td>${trade.side || ""}</td>
        <td>${fmtNumber(trade.quantity)}</td>
        <td>${trade.entry_price ?? ""}</td>
        <td>${trade.exit_price ?? ""}</td>
        <td class="${pnl >= 0 ? "pnl-good" : "pnl-bad"}">${fmtMoney(pnl, trade.currency || "USD")}</td>
        <td>${trade.strategy || ""}</td>
        <td>${trade.note || ""}</td>
      `;
      tbody.appendChild(tr);
    });
}

function groupPnlBy(key) {
  const map = {};
  trades.forEach(t => {
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

  trades.forEach(t => {
    const date = t.close_date || t.open_date;
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
      labels,
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
      t.strategy,
      t.note,
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
