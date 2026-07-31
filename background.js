// PriceScope Service Worker
// Handles all external API calls: Keepa, Anthropic Claude

const DEFAULT_CLAUDE_KEY = 'insert-api-key-here'; // Optional fallback key for users who don't provide their own

// Only use the default key if it's actually a real key, not the placeholder
const FALLBACK_CLAUDE_KEY = DEFAULT_CLAUDE_KEY.startsWith('sk-ant-') ? DEFAULT_CLAUDE_KEY : null;

// ─── DEMO MODE ────────────────────────────────────────────────────────────────
// Set to true to enable demo mode: synthetic price history + mock AI verdict.
// No API keys required. Set to false (and add real keys) for live use.
const DEMO_MODE = false;

function generateDemoPriceData(asin) {
  // Seed a simple deterministic value from the ASIN so each product looks different
  const seed = asin.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const rng = (i) => ((Math.sin(seed + i) + 1) / 2); // 0–1 pseudo-random

  const labels = [];
  const prices = [];
  const now = Date.now();
  const basePrice = 40 + (seed % 120); // $40–$160 base, varies by ASIN

  for (let day = 89; day >= 0; day--) {
    const date = new Date(now - day * 86400000);
    // Only add a data point every 2–4 days (mimics real Keepa data sparsity)
    if (day !== 89 && day !== 0 && rng(day * 3) > 0.55) continue;

    const wave = Math.sin(day / 15) * 0.08;       // slow price cycle
    const noise = (rng(day) - 0.5) * 0.12;        // day-to-day noise
    const trend = day > 45 ? 0.05 : -0.02;        // slight downtrend after midpoint
    const price = basePrice * (1 + wave + noise + trend * (day / 89));

    labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
    prices.push(Math.round(price * 100) / 100);
  }

  return { labels, prices };
}

function generateDemoVerdict(chartData) {
  const { prices } = chartData;
  const current = prices[prices.length - 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
  const pctAboveMin = ((current - min) / min * 100).toFixed(1);

  let score, verdict, reason;
  const ratio = (current - min) / (max - min);

  if (ratio < 0.2) {
    score = 9; verdict = 'Great Deal';
    reason = `At $${current.toFixed(2)}, this is only ${pctAboveMin}% above the 90-day low of $${min.toFixed(2)}. The 90-day average is $${avg}, making this one of the best prices seen recently. Strong buy.`;
  } else if (ratio < 0.4) {
    score = 7; verdict = 'Good Deal';
    reason = `The current price of $${current.toFixed(2)} is ${pctAboveMin}% above the 90-day low of $${min.toFixed(2)}, but still meaningfully below the average of $${avg}. A solid buy if you need it now.`;
  } else if (ratio < 0.65) {
    score = 5; verdict = 'Fair Price';
    reason = `At $${current.toFixed(2)}, this is ${pctAboveMin}% above the 90-day low of $${min.toFixed(2)} and near the average of $${avg}. Not a standout deal — consider waiting for a dip closer to $${min.toFixed(2)}.`;
  } else if (ratio < 0.85) {
    score = 3; verdict = 'Overpriced';
    reason = `The current price of $${current.toFixed(2)} is near the 90-day high of $${max.toFixed(2)}. The 90-day average is $${avg} and the low was $${min.toFixed(2)}. Wait for a price drop before buying.`;
  } else {
    score = 2; verdict = 'Wait';
    reason = `At $${current.toFixed(2)}, this is at or near the 90-day high of $${max.toFixed(2)}. The 90-day low was $${min.toFixed(2)} and the average was $${avg}. This price is historically high — wait.`;
  }

  return { score, verdict, reason };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'FETCH_PRICE_DATA') {
    handleFetchPriceData(message.asin).then(sendResponse);
    return true; // keep channel open for async response
  }
  if (message.type === 'FETCH_AI_VERDICT') {
    handleFetchAIVerdict(message.chartData, message.asin).then(sendResponse);
    return true;
  }
  if (message.type === 'GET_KEYS_STATUS') {
    handleGetKeysStatus().then(sendResponse);
    return true;
  }
  if (message.type === 'TEST_CLAUDE_KEY') {
    handleTestClaudeKey(message.key).then(sendResponse);
    return true;
  }
  if (message.type === 'TEST_KEEPA_KEY') {
    handleTestKeepaKey(message.key).then(sendResponse);
    return true;
  }
});

// ─── Keepa series parser ───────────────────────────────────────────────────────
// Keepa arrays are [ts, price, ts, price, ...] where ts is minutes since
// 2011-01-01 UTC, price is in cents, and -1 means unavailable. Crucially,
// entries are only recorded when the price CHANGES — so a product whose price
// has been stable for months has zero entries inside the 90-day window. We
// carry the last pre-window price forward and extend the series to today so
// stable-priced products chart as a flat line instead of erroring out.

function parseKeepaSeries(rawArray) {
  const KEEPA_EPOCH_OFFSET = 16070400; // Keepa epoch → Unix, in minutes
  const windowStart = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const fmt = (ms) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const labels = [];
  const prices = [];
  let lastPriceBeforeWindow = null;

  for (let i = 0; i < rawArray.length - 1; i += 2) {
    const priceRaw = rawArray[i + 1];
    if (priceRaw === -1) continue; // unavailable

    const dateMs = (rawArray[i] + KEEPA_EPOCH_OFFSET) * 60000;
    if (dateMs < windowStart) {
      lastPriceBeforeWindow = priceRaw; // remember, don't discard
      continue;
    }

    labels.push(fmt(dateMs));
    prices.push(priceRaw / 100);
  }

  // Seed the window with the carried-forward price so the chart starts at day -90
  if (lastPriceBeforeWindow !== null) {
    labels.unshift(fmt(windowStart));
    prices.unshift(lastPriceBeforeWindow / 100);
  }

  // Extend the series to today at the latest known price
  if (prices.length > 0) {
    labels.push(fmt(Date.now()));
    prices.push(prices[prices.length - 1]);
  }

  return { labels, prices };
}

// ─── FETCH_PRICE_DATA ──────────────────────────────────────────────────────────

async function handleFetchPriceData(asin) {
  if (DEMO_MODE) {
    const chartData = generateDemoPriceData(asin);
    return { success: true, chartData, cachedVerdict: null, asin, isDemo: true };
  }

  const { keepaKey } = await chrome.storage.sync.get('keepaKey');
  if (!keepaKey) {
    // No Keepa key — fall back to synthetic chart data so the widget still renders
    const chartData = generateDemoPriceData(asin);
    return { success: true, chartData, cachedVerdict: null, asin, isDemo: true };
  }

  // Check 24-hour cache
  const cacheKey = `cache_${asin}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    const entry = cached[cacheKey];
    if (Date.now() - entry.timestamp < 86400000) {
      return {
        success: true,
        chartData: entry.chartData,
        cachedVerdict: entry.verdict || null,
        asin
      };
    }
  }

  try {
    const url = `https://api.keepa.com/product?key=${keepaKey}&domain=1&asin=${asin}&history=1`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'PriceScope/1.0'
      }
    });
    if (!response.ok) {
      // Keepa rate-limited or error — fall back to synthetic data
      const chartData = generateDemoPriceData(asin);
      return { success: true, chartData, cachedVerdict: null, asin, isDemo: true };
    }

    const data = await response.json();
    const product = data.products?.[0];
    if (!product) return { error: 'NO_PRODUCT', detail: data.error?.message || 'Keepa returned no product for this ASIN' };

    // Try the Amazon-direct price series (csv[0]) first, then the lowest
    // marketplace-New price (csv[1]) for products Amazon doesn't sell directly.
    let chartData = null;
    for (const rawArray of [product.csv?.[0], product.csv?.[1]]) {
      if (!rawArray || rawArray.length < 2) continue;
      const parsed = parseKeepaSeries(rawArray);
      if (parsed.prices.length > 0) {
        chartData = parsed;
        break;
      }
    }

    if (!chartData) {
      return { error: 'NO_PRICE_DATA', detail: 'No usable price history in any Keepa series' };
    }

    // Cache result (fresh fetch clears any old verdict)
    await chrome.storage.local.set({
      [cacheKey]: { chartData, timestamp: Date.now() }
    });

    return { success: true, chartData, cachedVerdict: null, asin };
  } catch (err) {
    // Network error — fall back to synthetic data
    const chartData = generateDemoPriceData(asin);
    return { success: true, chartData, cachedVerdict: null, asin, isDemo: true };
  }
}

// ─── FETCH_AI_VERDICT ──────────────────────────────────────────────────────────

async function handleFetchAIVerdict(chartData, asin) {
  if (DEMO_MODE) {
    const verdict = generateDemoVerdict(chartData);
    return { success: true, verdict, isDemo: true };
  }

  const stored = await chrome.storage.sync.get('claudeKey');
  const claudeKey = stored.claudeKey || FALLBACK_CLAUDE_KEY;
  if (!claudeKey) return { error: 'NO_CLAUDE_KEY' };

  // Check if verdict is already cached for this ASIN
  const cacheKey = `cache_${asin}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]?.verdict && Date.now() - cached[cacheKey].timestamp < 86400000) {
    return { success: true, verdict: cached[cacheKey].verdict, fromCache: true };
  }

  const { prices } = chartData;
  const currentPrice = prices[prices.length - 1];
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const avgPrice = (prices.reduce((s, p) => s + p, 0) / prices.length).toFixed(2);
  const percentFromMin = ((currentPrice - minPrice) / minPrice * 100).toFixed(1);

  const prompt = `You are a price analysis assistant. Analyze this Amazon product's price history and give a buy recommendation.

Price History Summary (last 90 days):
- Current Price: $${currentPrice}
- 90-Day Low: $${minPrice}
- 90-Day High: $${maxPrice}
- 90-Day Average: $${avgPrice}
- Current price is ${percentFromMin}% above the 90-day low

Respond ONLY with a valid JSON object. No markdown, no explanation outside the JSON.
Format:
{
  "score": <integer 1-10, where 10 = best possible deal>,
  "verdict": "<one of: 'Great Deal', 'Good Deal', 'Fair Price', 'Overpriced', 'Wait'>",
  "reason": "<2-3 sentence explanation a shopper would find useful. Be specific about the numbers.>"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) return { error: 'API_ERROR', status: response.status };

    const data = await response.json();
    const rawText =
      data.content?.[0]?.text ||
      data.completion?.content?.[0]?.text ||
      data.completion?.content ||
      data.choices?.[0]?.message?.content ||
      data.output?.content?.[0]?.text ||
      '';

    if (!rawText) return { error: 'PARSE_ERROR' };

    let verdict;
    try {
      verdict = JSON.parse(rawText);
    } catch {
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        verdict = JSON.parse(match[1].trim());
      } else {
        return { error: 'PARSE_ERROR' };
      }
    }

    // FIX: Fetch cache entry again before saving (critical bug fix)
    try {
      const cacheEntry = await chrome.storage.local.get(cacheKey);
      if (cacheEntry[cacheKey]) {
        await chrome.storage.local.set({
          [cacheKey]: { ...cacheEntry[cacheKey], verdict, timestamp: cacheEntry[cacheKey].timestamp }
        });
      } else {
        // No existing cache entry, create new one
        await chrome.storage.local.set({
          [cacheKey]: { verdict, timestamp: Date.now() }
        });
      }
    } catch (err) {
      console.error('Failed to cache verdict:', err);
    }

    return { success: true, verdict };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
}

// ─── GET_KEYS_STATUS ───────────────────────────────────────────────────────────

async function handleGetKeysStatus() {
  if (DEMO_MODE) return { hasKeepaKey: true, hasClaudeKey: true, isDemo: true };
  const { keepaKey, claudeKey } = await chrome.storage.sync.get(['keepaKey', 'claudeKey']);
  return { hasKeepaKey: !!keepaKey, hasClaudeKey: !!(claudeKey || FALLBACK_CLAUDE_KEY) };
}

// ─── TEST_KEEPA_KEY ────────────────────────────────────────────────────────────
// Direct Keepa call with the provided key — bypasses cache and demo fallback so
// the Settings "Test" button reflects whether the key actually works.

async function handleTestKeepaKey(key) {
  try {
    const response = await fetch(
      `https://api.keepa.com/product?key=${encodeURIComponent(key)}&domain=1&asin=B08N5WRWNW`,
      { headers: { 'User-Agent': 'PriceScope/1.0' } }
    );
    if (!response.ok) return { ok: false, status: response.status };
    const data = await response.json();
    // Keepa can return 200 with an error object on bad keys
    if (data.error) return { ok: false, error: data.error.message || 'Invalid key' };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── TEST_CLAUDE_KEY ───────────────────────────────────────────────────────────

async function handleTestClaudeKey(key) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
      })
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
