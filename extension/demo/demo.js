(() => {
  const headerClock = document.getElementById("clock");
  const bigClock = document.getElementById("big-clock");
  const bigDate = document.getElementById("big-date");

  function tick() {
    const now = new Date();
    const t = now.toLocaleTimeString();
    if (headerClock) headerClock.textContent = t;
    if (bigClock) bigClock.textContent = t;
    if (bigDate) {
      bigDate.textContent = now.toLocaleDateString(undefined, {
        weekday: "long", year: "numeric", month: "long", day: "numeric"
      });
    }
  }
  tick();
  setInterval(tick, 250);

  const ticker = document.getElementById("ticker");
  const symbols = [
    { s: "NVDA", p: 892.1,  d: 1.2 },
    { s: "AAPL", p: 189.4,  d: -0.3 },
    { s: "BTC",  p: 67420,  d: 2.8 },
    { s: "ETH",  p: 3412,   d: -1.1 },
  ];

  function renderTicker() {
    if (!ticker) return;
    ticker.innerHTML = symbols.map((x) => {
      const cls = x.d >= 0 ? "up" : "down";
      const sign = x.d >= 0 ? "+" : "";
      const arrow = x.d >= 0 ? "▲" : "▼";
      return `
        <div class="ticker-row">
          <span class="ticker-sym">${x.s}</span>
          <span class="ticker-price">$${x.p.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          <span class="ticker-delta ${cls}">${arrow} ${sign}${x.d.toFixed(2)}%</span>
        </div>
      `;
    }).join("");

    symbols.forEach((x) => {
      x.p = Math.max(1, x.p * (1 + (Math.random() - 0.5) * 0.004));
      x.d = +(((Math.random() - 0.48) * 4).toFixed(2));
    });
  }

  renderTicker();
  setInterval(renderTicker, 1200);

  const metricsEl = document.getElementById("metrics");
  const metricData = [
    { label: "DAU",    value: 24810, unit: "",   delta: 3.2,  up: true },
    { label: "Revenue", value: 8420,  unit: "$",  delta: 5.7,  up: true },
    { label: "Latency", value: 142,   unit: "ms", delta: -2.1, up: false },
    { label: "Errors",  value: 7,     unit: "",   delta: -12,  up: true },
  ];

  function renderMetrics() {
    if (!metricsEl) return;
    metricsEl.innerHTML = metricData.map((m) => {
      const sign = m.delta >= 0 ? "+" : "";
      const cls = m.up ? "up" : "down";
      return `
        <div class="metric">
          <div class="metric-label">${m.label}</div>
          <div class="metric-value">${m.unit}${m.value.toLocaleString()}</div>
          <div class="metric-delta ${cls}">${sign}${m.delta}% this week</div>
        </div>
      `;
    }).join("");

    metricData.forEach((m) => {
      m.value = Math.max(1, Math.round(m.value * (1 + (Math.random() - 0.5) * 0.008)));
      m.delta = +(((Math.random() - 0.45) * 8).toFixed(1));
      m.up = m.delta >= 0;
    });
  }

  renderMetrics();
  setInterval(renderMetrics, 2000);
})();