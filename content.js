// PriceScope Content Script
// Runs on Amazon product pages: detects ASIN, injects UI, renders chart + AI verdict

(async function () {
  // ─── Step 1: Extract ASIN ──────────────────────────────────────────────────

  function extractASIN() {
    const path = window.location.pathname;
    const patterns = [
      /\/dp\/([A-Z0-9]{10})/,
      /\/gp\/product\/([A-Z0-9]{10})/,
      /\/gp\/aw\/d\/([A-Z0-9]{10})/
    ];

    for (const pattern of patterns) {
      const match = path.match(pattern);
      if (match) return match[1];
    }

    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('ASIN')) {
      const asin = urlParams.get('ASIN');
      if (asin && /^[A-Z0-9]{10}$/.test(asin)) return asin;
    }

    const asinInput = document.getElementById('ASIN');
    if (asinInput && /^[A-Z0-9]{10}$/.test(asinInput.value)) return asinInput.value;
    return null;
  }

  const asin = extractASIN();
  if (!asin) return; // Not a product page we can handle

  // ─── Step 2: Find injection point (with MutationObserver fallback) ─────────

  function findAnchor() {
    return (
      document.getElementById('dp-container') ||
      document.getElementById('ppd') ||
      document.getElementById('centerCol')
    );
  }

  async function waitForAnchor(timeoutMs = 3000) {
    const anchor = findAnchor();
    if (anchor) return anchor;

    return new Promise((resolve) => {
      let timer;
      const observer = new MutationObserver(() => {
        const el = findAnchor();
        if (el) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => {
        observer.disconnect();
        resolve(null); // timed out
      }, timeoutMs);
    });
  }

  const anchor = await waitForAnchor();
  if (!anchor) return; // Abort silently

  // ─── Step 3: Build and inject UI ──────────────────────────────────────────

  const container = document.createElement('div');
  container.id = 'pricescope-container';

  const header = document.createElement('div');
  header.id = 'pricescope-header';

  const title = document.createElement('span');
  title.id = 'pricescope-title';
  title.textContent = '📊 PriceScope';

  const status = document.createElement('span');
  status.id = 'pricescope-status';
  status.textContent = 'Loading price history...';

  header.appendChild(title);
  header.appendChild(status);

  const chartWrapper = document.createElement('div');
  chartWrapper.id = 'pricescope-chart-wrapper';

  const canvas = document.createElement('canvas');
  canvas.id = 'pricescope-chart';
  chartWrapper.appendChild(canvas);

  const verdictWrapper = document.createElement('div');
  verdictWrapper.id = 'pricescope-verdict-wrapper';

  const footer = document.createElement('div');
  footer.id = 'pricescope-footer';

  const footerLeft = document.createElement('span');
  footerLeft.textContent = 'Price data via Keepa';

  const settingsLink = document.createElement('a');
  settingsLink.id = 'pricescope-settings-link';
  settingsLink.href = '#';
  settingsLink.textContent = 'Settings';
  settingsLink.addEventListener('click', (e) => {
    e.preventDefault();
    window.open(chrome.runtime.getURL('options.html'), '_blank');
  });

  footer.appendChild(footerLeft);
  footer.appendChild(settingsLink);

  container.appendChild(header);
  container.appendChild(chartWrapper);
  container.appendChild(verdictWrapper);
  container.appendChild(footer);

  anchor.insertAdjacentElement('afterend', container);

  // ─── Step 4: Fetch price data ─────────────────────────────────────────────

  let chartData = null;

  const priceResult = await chrome.runtime.sendMessage({
    type: 'FETCH_PRICE_DATA',
    asin
  });

  if (priceResult.error === 'NO_KEEPA_KEY') {
    status.textContent = 'API key required.';
    chartWrapper.style.display = 'none';
    verdictWrapper.innerHTML = `<p id="pricescope-no-key-msg">
      Add your Keepa API key in
      <a href="${chrome.runtime.getURL('options.html')}" target="_blank">Settings</a>
      to see price history.
    </p>`;
    return;
  }

  if (!priceResult.success) {
    status.textContent = 'Could not load price data. Try again later.';
    chartWrapper.style.display = 'none';
    return;
  }

  chartData = priceResult.chartData;
  const currentPrice = chartData.prices[chartData.prices.length - 1];
  status.textContent = `Current Price: $${currentPrice.toFixed(2)}`;

  // Render chart
  try {
    renderChart(chartData);
  } catch {
    chartWrapper.style.display = 'none';
  }

  // ─── Step 5: Fetch AI verdict (use cached if available) ──────────────────────

  if (priceResult.cachedVerdict) {
    renderVerdict(priceResult.cachedVerdict);
    await chrome.storage.local.set({
      currentPageData: { asin, currentPrice, verdict: priceResult.cachedVerdict, timestamp: Date.now() }
    });
    return;
  }

  verdictWrapper.innerHTML = '<div id="pricescope-loading">Analyzing deal...</div>';

  const verdictResult = await chrome.runtime.sendMessage({
    type: 'FETCH_AI_VERDICT',
    chartData,
    asin
  });

  if (!verdictResult.success) {
    if (verdictResult.error === 'NO_CLAUDE_KEY') {
      verdictWrapper.innerHTML = `<p id="pricescope-no-key-msg">
        Add your Anthropic API key in
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">Settings</a>
        to get AI deal analysis.
      </p>`;
    } else {
      verdictWrapper.innerHTML = '<p>AI analysis unavailable. Try again later.</p>';
    }
    return;
  }

  const { verdict } = verdictResult;
  renderVerdict(verdict);

  // ─── Step 6: Store result for popup ───────────────────────────────────────

  await chrome.storage.local.set({
    currentPageData: {
      asin,
      currentPrice,
      verdict,
      timestamp: Date.now()
    }
  });

  // ─── Chart renderer ───────────────────────────────────────────────────────

  function renderChart(data) {
    new window.Chart(document.getElementById('pricescope-chart'), {
      type: 'line',
      data: {
        labels: data.labels,
        datasets: [{
          label: 'Price (USD)',
          data: data.prices,
          borderColor: '#e47911',
          backgroundColor: 'rgba(228, 121, 17, 0.08)',
          tension: 0.3,
          pointRadius: 2,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => `$${ctx.parsed.y.toFixed(2)}`
            }
          }
        },
        scales: {
          y: {
            ticks: { callback: val => `$${val.toFixed(2)}` }
          }
        }
      }
    });
  }

  // ─── Verdict renderer ─────────────────────────────────────────────────────

  function renderVerdict(v) {
    const score = v.score;
    let scoreClass;
    if (score <= 3) scoreClass = 'score-low';
    else if (score <= 6) scoreClass = 'score-mid';
    else scoreClass = 'score-high';

    const verdictEl = document.createElement('div');
    verdictEl.id = 'pricescope-verdict';

    const badge = document.createElement('div');
    badge.id = 'pricescope-score-badge';
    badge.className = scoreClass;
    badge.textContent = `${score}/10`;

    const textGroup = document.createElement('div');

    const verdictText = document.createElement('div');
    verdictText.id = 'pricescope-verdict-text';
    verdictText.textContent = v.verdict;

    const reason = document.createElement('div');
    reason.id = 'pricescope-reason';
    reason.textContent = v.reason;

    textGroup.appendChild(verdictText);
    textGroup.appendChild(reason);

    verdictEl.appendChild(badge);
    verdictEl.appendChild(textGroup);

    verdictWrapper.innerHTML = '';
    verdictWrapper.appendChild(verdictEl);
  }
})();
