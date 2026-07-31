# PriceScope

PriceScope is a Chrome Extension (Manifest V3) that automatically detects when you're on an Amazon product page, fetches up to 90 days of price history from the Keepa API, renders an interactive Chart.js price history chart directly on the page, and sends that data to the Anthropic Claude API to generate an AI-powered buy recommendation — complete with a deal score (1–10), a verdict label, and a plain-English explanation of whether now is a good time to buy.

---

## Features

- **Automatic ASIN detection** — reads the product ID from the Amazon URL via three regex patterns (`/dp/`, `/gp/product/`, `/gp/aw/d/`) with URL-parameter and DOM fallbacks
- **Dynamic DOM injection** — uses a `MutationObserver` (3-second timeout) to wait for Amazon's dynamically loaded page anchor before injecting the widget
- **90-day price history chart** — interactive Chart.js line chart rendered inline on the product page, styled to match Amazon's aesthetic; Chart.js is **bundled locally** (bypasses Amazon's Content Security Policy)
- **AI deal verdict** — Claude analyzes current vs. historical prices and returns a scored recommendation: Great Deal, Good Deal, Fair Price, Overpriced, or Wait
- **Deal score badge** — color-coded 1–10 badge (green ≥7 / orange 4–6 / red ≤3) visible both on-page and in the extension popup
- **Dual-level caching** — both Keepa price data *and* the Claude verdict are cached together under a single `cache_{ASIN}` key for 24 hours, so repeat visits incur zero API calls
- **Secure API key storage** — keys stored in `chrome.storage.sync`; never hardcoded or sent anywhere other than the official APIs
- **Optional default Claude key** — a bundled fallback Claude key can be set in `background.js` for deployments where users don't supply their own
- **3-state popup UI** — the extension popup shows one of: (1) setup prompt when keys are missing, (2) "visit a product page" prompt when no recent data exists, or (3) the full score/verdict display
- **`currentPageData` cross-context bridge** — after each analysis, content.js writes `{asin, currentPrice, verdict, timestamp}` to `chrome.storage.local` so the popup can display results without making any new API calls

---

## Setup

1. **Clone this repo**

2. **Open Chrome and navigate to** `chrome://extensions`

3. **Enable Developer Mode** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the `pricescope/` folder

5. **Click the PriceScope extension icon** → click ⚙️ or "Open Settings"

6. **Enter your API keys:**
   - **Keepa API key** — sign up at [keepa.com](https://keepa.com/#!api)
   - **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)

7. **Visit any Amazon product page** — PriceScope will automatically inject the price chart and AI analysis below the product details section

---

## How to Run

No build step, no compilation, no server required. PriceScope runs entirely inside Chrome.

**After completing Setup above:**

1. Open Chrome and go to any Amazon product page, for example:
   ```
   https://www.amazon.com/dp/B08N5WRWNW
   ```

2. Wait 1–2 seconds. The **PriceScope widget** will appear automatically below the product details section — no clicking required.

3. The widget loads in two phases:
   - **Phase 1 (~200–500ms):** The 90-day price chart and current price appear
   - **Phase 2 (~1–3s):** The AI deal score badge and reasoning text appear below the chart

4. On **repeat visits to the same product** within 24 hours, both the chart and verdict load from local cache in under 400ms — no API calls are made.

5. Click the **PriceScope icon** in the Chrome toolbar at any time to see the current product's score in the popup without leaving the page.

> **Troubleshooting:** If the widget does not appear, open the Settings page (click the extension icon → Settings) and confirm both API keys show a green ✓ Connected status after clicking their Test buttons.

---

## Example Usage

### Scenario: Checking whether a product is at a good price

1. Navigate to an Amazon product page — for example, a pair of headphones listed at **$89.99** with a "Was $129.99" badge.

2. PriceScope injects its widget below the product details:

   ```
   ┌─────────────────────────────────────────────────────┐
   │ 📊 PriceScope               Current Price: $89.99   │
   │                                                     │
   │  $130 ┤                                             │
   │  $110 ┤  ╭──╮                                       │
   │   $90 ┤──╯  ╰──────────────────────────────── ●    │
   │   $70 ┤                                             │
   │       └────────────────────────────────────────     │
   │        Feb 1        Mar 1        Apr 1   Apr 23     │
   │                                                     │
   │  [ 4/10 ]  Fair Price                               │
   │  The current price of $89.99 is 28.6% above the    │
   │  90-day low of $69.99 reached in February. The      │
   │  average price over the last 90 days is $94.20,     │
   │  so this is near average — not a standout deal.     │
   │  Consider waiting for a dip closer to $70.          │
   │                                                     │
   │  Price data via Keepa                    Settings   │
   └─────────────────────────────────────────────────────┘
   ```

3. The **score badge** is color-coded:
   - 🟢 **7–10** — Great Deal or Good Deal (green)
   - 🟡 **4–6** — Fair Price or borderline (orange)
   - 🔴 **1–3** — Overpriced or Wait (red)

4. Click the **PriceScope toolbar icon** to see a compact popup version of the same score without scrolling:

   ```
   ┌──────────────────────────┐
   │ PriceScope               │
   │ ASIN: B08N5WRWNW         │
   │ Current Price: $89.99    │
   │                          │
   │       [ 4/10 ]           │
   │       Fair Price         │
   │  Near average — not a    │
   │  standout deal.          │
   │                          │
   │ [⚙ Open Settings]        │
   └──────────────────────────┘
   ```

### Supported Amazon URL formats

PriceScope activates automatically on all of these:

```
https://www.amazon.com/dp/B08N5WRWNW
https://www.amazon.com/Echo-Dot/dp/B08N5WRWNW
https://www.amazon.com/gp/product/B08N5WRWNW
https://www.amazon.com/gp/aw/d/B08N5WRWNW
```

It exits silently on pages that are not product listings (search results, homepage, cart, etc.).

---

## File Structure

```
pricescope/
├── manifest.json         # MV3 extension config — permissions, content scripts, service worker
├── background.js         # Service worker: Keepa API, Claude API, caching, key-status handler
├── content.js            # Content script: ASIN detection, DOM injection, chart + verdict rendering
├── content.css           # Styles for the injected PriceScope widget
├── popup.html            # Extension icon popup markup
├── popup.js              # Popup logic: 3-state UI, reads chrome.storage.local
├── popup.css             # Popup styles
├── options.html          # Settings page markup
├── options.js            # Settings logic: save/load keys, Test Keepa, Test Claude buttons
├── options.css           # Settings page styles
├── chart.umd.min.js      # Chart.js 4.4.0 bundled locally (bypasses Amazon's CSP)
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

---

## Architecture

```
User visits amazon.com/dp/ASIN
        │
        ▼
  content.js (content script)
    • Extracts ASIN from URL (3 regex patterns + URL param + DOM fallbacks)
    • Waits for Amazon anchor via MutationObserver (3s timeout)
    • Injects PriceScope UI widget into the page
    • Sends messages to background.js for all API calls
        │
        ├─ FETCH_PRICE_DATA ──────────────────────────────────────────────────┐
        │                                                                     ▼
        │                                                           background.js (service worker)
        │                                                             • Checks cache_{ASIN} (24h TTL)
        │                                                             • Cache hit → returns chartData + cachedVerdict
        │                                                             • Cache miss → calls Keepa API
        │                                                                 └─ Parses flat timestamp/price array
        │                                                                 └─ Converts Keepa epoch → Unix ms
        │                                                                 └─ Filters last 90 days, cents → dollars
        │                                                                 └─ Caches chartData in chrome.storage.local
        │
        ├─ FETCH_AI_VERDICT (skipped if cachedVerdict returned above) ────────┐
        │                                                                     ▼
        │                                                           background.js
        │                                                             • Calls Anthropic Claude API (claude-haiku-4-5)
        │                                                             • Sends price stats: current, min, max, avg, %fromMin
        │                                                             • Parses JSON {score, verdict, reason}
        │                                                             • Merges verdict into existing cache_{ASIN} entry
        │
        ├─ GET_KEYS_STATUS ───────────────────────────────────────────────────┐
        │                                                                     ▼
        │                                                           background.js
        │                                                             • Reads chrome.storage.sync (no external call)
        │                                                             • Returns {hasKeepaKey, hasClaudeKey}
        │                                                             • Used by popup.js to determine which UI state to show
        │
        ▼
  content.js receives results
    • Renders Chart.js line chart (bundled locally as chart.umd.min.js)
    • Renders score badge + verdict label + reason text
    • Writes currentPageData {asin, currentPrice, verdict, timestamp}
      to chrome.storage.local for popup access
        │
        ▼
  popup.js reads chrome.storage.local
    • State 1 — No keys: shows setup prompt
    • State 2 — No recent data (>5 min old): shows "visit a product" prompt
    • State 3 — Data present: displays score badge + verdict (no new API calls)
```

---

## Message Types

| Message | Sender | Handler | Purpose |
|---|---|---|---|
| `FETCH_PRICE_DATA` | content.js | background.js | Retrieve Keepa history (cache-aware) |
| `FETCH_AI_VERDICT` | content.js | background.js | Generate Claude verdict (cache-aware) |
| `GET_KEYS_STATUS` | popup.js | background.js | Check whether API keys are configured |

---

## API Keys Required

| Key | Where to get it | Cost |
|-----|-----------------|------|
| **Keepa API** | [keepa.com/#!api](https://keepa.com/#!api) | Free tier available; 1 token/minute at no cost |
| **Anthropic API** | [console.anthropic.com](https://console.anthropic.com) | Pay-per-use; claude-haiku-4-5 costs a fraction of a cent per analysis |

---

## Caching Strategy

| Cache key | Contents | TTL | Storage |
|---|---|---|---|
| `cache_{ASIN}` | `{chartData, verdict, timestamp}` | 24 hours | `chrome.storage.local` |
| `currentPageData` | `{asin, currentPrice, verdict, timestamp}` | 5 minutes (popup check) | `chrome.storage.local` |
| `keepaKey`, `claudeKey` | API credentials | Permanent until changed | `chrome.storage.sync` |

On a cache hit, `FETCH_PRICE_DATA` returns both `chartData` and `cachedVerdict`. If `cachedVerdict` is present, content.js skips the `FETCH_AI_VERDICT` message entirely — only the first visit per 24-hour window incurs any Claude API cost.

---

## Limitations / Known Issues

- Only supports **amazon.com** (US) in v1.0 — `.co.uk`, `.ca`, `.de`, etc. are not matched by the content script
- Price history is limited to the **last 90 days** of Keepa data (1-year history requires a paid Keepa tier)
- Keepa's free tier has rate limits; PriceScope caches results for **24 hours** per ASIN to minimize API calls
- Product variation pages (color/size selectors) are not yet tracked — ASIN changes client-side via JS and requires a `MutationObserver` loop (planned for v2.0)
- No seasonal context — Claude does not account for holidays or demand spikes
