(() => {
  const clock = document.getElementById("clock");
  if (clock) {
    setInterval(() => {
      clock.textContent = new Date().toLocaleTimeString();
    }, 250);
  }

  // Simple “live” DOM changes for TearAway demo (proves it stays live).
  const ticker = document.getElementById("ticker");
  if (!ticker) return;

  const symbols = [
    { s: "NVDA", p: 892.1, d: 1.2 },
    { s: "AAPL", p: 189.4, d: -0.3 },
    { s: "BTC", p: 67420, d: 2.8 },
    { s: "ETH", p: 3412, d: -1.1 },
  ];

  function renderTicker() {
    ticker.innerHTML = symbols
      .map((x) => {
        const cls = x.d >= 0 ? "up" : "down";
        const sign = x.d >= 0 ? "+" : "";
        return `<span class="pill ${cls}">${x.s} $${x.p.toLocaleString()} ${sign}${x.d}%</span>`;
      })
      .join("");

    symbols.forEach((x) => {
      x.p *= 1 + (Math.random() - 0.5) * 0.004;
      x.d = (Math.random() - 0.48) * 4;
    });
  }

  renderTicker();
  setInterval(renderTicker, 1200);
})();

