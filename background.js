// PriceScope Service Worker
// Handles all external API calls: Keepa, Anthropic Claude

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
});

// ─── FETCH_PRICE_DATA ──────────────────────────────────────────────────────────

async function handleFetchPriceData(asin) {
  const { keepaKey } = await chrome.storage.sync.get('keepaKey');
  if (!keepaKey) return { error: 'NO_KEEPA_KEY' };

  // Check 24-hour cache
  const cacheKey = `cache_${asin}`;
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached[cacheKey]) {
    const entry = cached[cacheKey];
    if (Date.now() - entry.timestamp < 86400000) {
      return { success: true, chartData: entry.chartData, asin };
    }
  }

  try {
    const url = `https://api.keepa.com/product?key=${keepaKey}&domain=1&asin=${asin}&history=1`;
    const response = await fetch(url);
    if (!response.ok) return { error: 'API_ERROR', status: response.status };

    const data = await response.json();
    const product = data.products?.[0];
    if (!product) return { error: 'API_ERROR', status: 404 };

    // csv[0] = Amazon price array: [ts, price, ts, price, ...]
    const rawArray = product.csv?.[0];
    if (!rawArray || rawArray.length < 2) {
      return { error: 'API_ERROR', status: 422 };
    }

    // Keepa epoch: minutes since 2011-01-01 00:00 UTC
    // Unix offset in minutes: 16070400
    const KEEPA_EPOCH_OFFSET = 16070400;
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;

    const labels = [];
    const prices = [];

    for (let i = 0; i < rawArray.length - 1; i += 2) {
      const keepaTs = rawArray[i];
      const priceRaw = rawArray[i + 1];

      if (priceRaw === -1) continue; // unavailable

      const dateMs = (keepaTs + KEEPA_EPOCH_OFFSET) * 60000;
      if (dateMs < ninetyDaysAgo) continue; // outside 90-day window

      const date = new Date(dateMs);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      prices.push(priceRaw / 100);
    }

    if (prices.length === 0) {
      return { error: 'API_ERROR', status: 422 };
    }

    const chartData = { labels, prices };

    // Cache result
    await chrome.storage.local.set({
      [cacheKey]: { chartData, timestamp: Date.now() }
    });

    return { success: true, chartData, asin };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
}

// ─── FETCH_AI_VERDICT ──────────────────────────────────────────────────────────

async function handleFetchAIVerdict(chartData, asin) {
  const { claudeKey } = await chrome.storage.sync.get('claudeKey');
  if (!claudeKey) return { error: 'NO_CLAUDE_KEY' };

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
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) return { error: 'API_ERROR', status: response.status };

    const data = await response.json();
    const rawText = data.content?.[0]?.text;
    if (!rawText) return { error: 'PARSE_ERROR' };

    let verdict;
    try {
      verdict = JSON.parse(rawText);
    } catch {
      // Try stripping markdown code fences if Claude wrapped the JSON
      const match = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) {
        verdict = JSON.parse(match[1].trim());
      } else {
        return { error: 'PARSE_ERROR' };
      }
    }

    return { success: true, verdict };
  } catch (err) {
    return { error: 'NETWORK_ERROR', message: err.message };
  }
}

// ─── GET_KEYS_STATUS ───────────────────────────────────────────────────────────

async function handleGetKeysStatus() {
  const { keepaKey, claudeKey } = await chrome.storage.sync.get(['keepaKey', 'claudeKey']);
  return { hasKeepaKey: !!keepaKey, hasClaudeKey: !!claudeKey };
}
