// PriceScope Content Script
// Runs on Amazon product pages: detects ASIN, injects UI, renders chart + AI verdict
//
// v1.1 rewrite — injection strategy overhaul:
//   The original version inserted the widget AFTER #dp-container. On modern Amazon
//   layouts that element wraps the entire product section, so "after it" placed the
//   widget below the reviews and carousels — technically rendered, never seen.
//   This version targets small, visible elements near the title/price first, and
//   only falls back to prepending INSIDE large containers (never after them).
//   All steps log to the console with a [PriceScope] prefix for easy debugging.

(async function () {
  const log = (...args) => console.log('%c[PriceScope]', 'color:#e47911;font-weight:bold', ...args);

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
  if (!asin) {
    log('No ASIN found in URL — not a product page, exiting.');
    return;
  }
  log('ASIN detected:', asin);

  // ─── Step 2: Find injection point ─────────────────────────────────────────
  //
  // Ordered list of injection targets. Each entry is [selector, position]:
  //   'afterend'   — insert as a sibling right after the element (small elements
  //                  in the center column, guaranteed visible near the fold)
  //   'afterbegin' — insert as the FIRST child inside the element (safe fallback
  //                  for large wrapper containers; top of container = visible)
  const INJECTION_TARGETS = [
    ['#productOverview_feature_div', 'afterend'],  // spec table under the price
    ['#featurebullets_feature_div',  'afterend'],  // "About this item" bullets
    ['#apex_desktop',                'afterend'],  // price block
    ['#titleSection',                'afterend'],  // product title
    ['#centerCol',                   'afterbegin'],// top of center column
    ['#ppd',                         'afterbegin'],
    ['#dp-container',                'afterbegin'] // top of (huge) container — never 'afterend'
  ];

  function findTarget() {
    for (const [selector, position] of INJECTION_TARGETS) {
      const el = document.querySelector(selector);
      if (el) return { el, position, selector };
    }
    return null;
  }

  async function waitForTarget(timeoutMs = 5000) {
    const found = findTarget();
    if (found) return found;

    log('No injection target yet — watching DOM for up to', timeoutMs, 'ms…');
    return new Promise((resolve) => {
      let timer;
      const observer = new MutationObserver(() => {
        const t = findTarget();
        if (t) {
          observer.disconnect();
          clearTimeout(timer);
          resolve(t);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      timer = setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  }

  const target = await waitForTarget();
  if (!target) {
    log('ERROR: No injection target found after timeout. Amazon layout may have changed.',
        'Tried selectors:', INJECTION_TARGETS.map(t => t[0]).join(', '));
    return;
  }
  log(`Injecting widget ${target.position === 'afterend' ? 'after' : 'inside top of'} ${target.selector}`);

  // ─── Step 3: Build and inject UI ──────────────────────────────────────────

  const container = document.createElement('div');
  container.id = 'pricescope-container';

  const header = document.createElement('div');
  header.id = 'pricescope-header';

  const title = document.createElement('span');
  title.id = 'pricescope-title';
  title.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" style="vertical-align:-2px;margin-right:6px"><rect width="16" height="16" rx="3" fill="#0e7490"/><path d="M3 11l3-3.5 2.5 2L13 4.5" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="13" cy="4.5" r="1.3" fill="#fff"/></svg>PriceScope`;

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

  target.el.insertAdjacentElement(target.position, container);
  log('Widget injected. Fetching price data…');

  // ─── Step 4: Fetch price data ─────────────────────────────────────────────

  let priceResult;
  try {
    priceResult = await chrome.runtime.sendMessage({ type: 'FETCH_PRICE_DATA', asin });
  } catch (err) {
    log('ERROR: Message to service worker failed:', err.message,
        '— try reloading the extension at chrome://extensions');
    status.textContent = 'Extension error — reload the extension and refresh.';
    chartWrapper.style.display = 'none';
    return;
  }
  log('Price data response:', priceResult);

  if (!priceResult || !priceResult.success) {
    status.textContent = 'Could not load price data. Try again later.';
    chartWrapper.style.display = 'none';
    return;
  }

  const chartData = priceResult.chartData;

  // Show demo mode notice in footer
  if (priceResult.isDemo) {
    log('Running in DEMO mode — synthetic price data (no valid Keepa response).');
    footerLeft.textContent = '⚠ Demo mode — add API keys in Settings for live data';
    footerLeft.style.color = '#c40000';
  }

  // Guard against empty prices array
  if (!chartData || !chartData.prices || chartData.prices.length === 0) {
    log('Price data was empty for this ASIN.');
    status.textContent = 'No price data available.';
    chartWrapper.style.display = 'none';
    verdictWrapper.innerHTML = '<p id="pricescope-no-key-msg">This product has no price history in the last 90 days.</p>';
    return;
  }

  const currentPrice = chartData.prices[chartData.prices.length - 1];
  const minPrice = Math.min(...chartData.prices);
  const maxPrice = Math.max(...chartData.prices);
  status.textContent = `Current Price: $${currentPrice.toFixed(2)}`;

  // ─── Flat-line detection ──────────────────────────────────────────────────
  // A chart of a price that never moved is visual noise (the y-axis auto-zooms
  // onto nothing). Swap it for a one-line steady-price notice instead.
  const isFlat = (maxPrice - minPrice) < Math.max(0.01, maxPrice * 0.005);
  if (isFlat) {
    log('Price is flat across the 90-day window — showing steady-price notice instead of chart.');
    chartWrapper.style.display = 'none';
    const flat = document.createElement('div');
    flat.id = 'pricescope-flat-notice';
    flat.innerHTML = `<svg width="40" height="12" viewBox="0 0 40 12" xmlns="http://www.w3.org/2000/svg"><path d="M1 6h38" stroke="#0e7490" stroke-width="2" stroke-linecap="round"/></svg><span>Price unchanged for the last 90 days &mdash; steady at <strong>$${currentPrice.toFixed(2)}</strong></span>`;
    container.insertBefore(flat, verdictWrapper);
  } else {
    renderChart(chartData);
  }

  // ─── Fake discount detector ───────────────────────────────────────────────
  // Amazon's "-30% List Price $X" badges often reference a price the item never
  // actually sold at. Compare the claimed list price against the observed
  // 90-day maximum and call out inflated markdowns.
  runDiscountCheck();

  function extractListPrice() {
    const selectors = [
      '#corePriceDisplay_desktop_feature_div .a-price.a-text-price .a-offscreen',
      '#corePrice_desktop .a-price.a-text-price .a-offscreen',
      'span.basisPrice .a-price .a-offscreen',
      '#priceblock_listprice',
      '#listPrice'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const m = el.textContent.replace(/[,\s]/g, '').match(/\$?(\d+(?:\.\d{1,2})?)/);
      if (m) return parseFloat(m[1]);
    }
    return null;
  }

  function runDiscountCheck() {
    if (priceResult.isDemo) return; // only meaningful with real price history

    const listPrice = extractListPrice();
    if (!listPrice || listPrice <= currentPrice + 0.01) {
      log('Discount check: no strike-through list price on this page.');
      return;
    }

    const claimedPct = Math.round((1 - currentPrice / listPrice) * 100);
    const note = document.createElement('div');
    note.id = 'pricescope-discount-check';

    if (listPrice > maxPrice * 1.05) {
      note.className = 'inflated';
      note.textContent = `\u26A0 Inflated list price: this item hasn't sold above $${maxPrice.toFixed(2)} in the last 90 days, so the ${claimedPct}% off claim (vs $${listPrice.toFixed(2)}) is overstated.`;
      log(`Discount check: INFLATED — claimed list $${listPrice.toFixed(2)} vs observed 90-day max $${maxPrice.toFixed(2)}`);
    } else {
      note.className = 'verified';
      note.textContent = `\u2713 Real discount: this item sold at $${maxPrice.toFixed(2)} within the last 90 days, so the ${claimedPct}% markdown is genuine.`;
      log(`Discount check: verified — claimed list $${listPrice.toFixed(2)} is consistent with observed max $${maxPrice.toFixed(2)}`);
    }
    container.insertBefore(note, verdictWrapper);
  }

  // ─── Step 5: Fetch AI verdict (use cached if available) ───────────────────

  if (priceResult.cachedVerdict) {
    log('Using cached verdict (24h cache hit) — no Claude API call.');
    renderVerdict(priceResult.cachedVerdict);
    await storeForPopup(priceResult.cachedVerdict);
    return;
  }

  verdictWrapper.innerHTML = '<div id="pricescope-loading">Analyzing deal...</div>';
  log('Requesting AI verdict…');

  const verdictResult = await chrome.runtime.sendMessage({
    type: 'FETCH_AI_VERDICT',
    chartData,
    asin
  });
  log('Verdict response:', verdictResult);

  if (!verdictResult || !verdictResult.success) {
    if (verdictResult && verdictResult.error === 'NO_CLAUDE_KEY') {
      verdictWrapper.innerHTML = `<p id="pricescope-no-key-msg">
        Add your Anthropic API key in
        <a href="${chrome.runtime.getURL('options.html')}" target="_blank">Settings</a>
        to get AI deal analysis.
      </p>`;
    } else {
      log('Verdict failed:', verdictResult && (verdictResult.error || verdictResult.status));
      verdictWrapper.innerHTML = '<p id="pricescope-no-key-msg">AI analysis unavailable. Try again later.</p>';
    }
    return;
  }

  renderVerdict(verdictResult.verdict);
  await storeForPopup(verdictResult.verdict);
  log('Done.');

  // ─── Step 6: Store result for popup ───────────────────────────────────────

  async function storeForPopup(verdict) {
    await chrome.storage.local.set({
      currentPageData: { asin, currentPrice, verdict, timestamp: Date.now() }
    });
  }

  // ─── Chart renderer ───────────────────────────────────────────────────────

  function renderChart(data) {
    if (!window.Chart) {
      log('ERROR: Chart.js not loaded — check that chart.umd.min.js is listed before content.js in manifest.json');
      chartWrapper.innerHTML = '<p style="color:#c40000;">Chart library failed to load. Please refresh the page.</p>';
      return;
    }

    try {
      new window.Chart(canvas, {
        type: 'line',
        data: {
          labels: data.labels,
          datasets: [{
            label: 'Price (USD)',
            data: data.prices,
            borderColor: '#0e7490',
            backgroundColor: 'rgba(14, 116, 144, 0.08)',
            tension: 0.3,
            pointRadius: 2,
            fill: true
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
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
              ticks: { callback: val => `$${Number(val).toFixed(2)}` }
            }
          }
        }
      });
      log('Chart rendered:', data.prices.length, 'data points.');
    } catch (err) {
      log('ERROR: Chart rendering threw:', err);
      chartWrapper.innerHTML = '<p style="color:#c40000;">Failed to render chart. Please refresh the page.</p>';
    }
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