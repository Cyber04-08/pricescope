# PriceScope

PriceScope is a Chrome Extension (Manifest V3) that automatically detects when you're on an Amazon product page, fetches up to 90 days of price history from the Keepa API, renders an interactive Chart.js price history chart directly on the page, and sends that data to the Anthropic Claude API to generate an AI-powered buy recommendation — complete with a deal score (1–10), a verdict label, and a plain-English explanation of whether now is a good time to buy.

---

## Features

- **Automatic ASIN detection** — reads the product ID from the Amazon URL (no clicking required)
- **90-day price history chart** — interactive line chart rendered inline on the product page, styled to match Amazon's aesthetic
- **AI deal verdict** — Claude analyzes current vs. historical prices and returns a scored recommendation: Great Deal, Good Deal, Fair Price, Overpriced, or Wait
- **Deal score badge** — color-coded 1–10 badge (green / yellow / red) visible both on-page and in the extension popup
- **Secure API key storage** — keys stored in `chrome.storage.sync`; never hardcoded or sent anywhere other than the official APIs
- **24-hour result caching** — Keepa results are cached locally to stay within free-tier rate limits
- **One-click popup** — click the extension icon on any Amazon page to see the current product's score at a glance

---

## Setup

1. **Clone this repo**
   ```bash
   git clone https://github.com/Cyber04-08/pricescope.git
   ```

2. **Open Chrome and navigate to** `chrome://extensions`

3. **Enable Developer Mode** (toggle in the top-right corner)

4. **Click "Load unpacked"** and select the `pricescope/` folder

5. **Click the PriceScope extension icon** → click ⚙️ or "Open Settings"

6. **Enter your API keys:**
   - **Keepa API key** — sign up at [keepa.com](https://keepa.com/#!api)
   - **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)

7. **Visit any Amazon product page** — PriceScope will automatically inject the price chart and AI analysis below the product details section

---

## Architecture

```
User visits amazon.com/dp/ASIN
        │
        ▼
  content.js (content script)
    • Extracts ASIN from URL
    • Injects PriceScope UI widget into the page
    • Sends messages to background.js for all API calls
        │
        ▼
  background.js (service worker)
    • FETCH_PRICE_DATA → Keepa API
        └─ Parses flat timestamp/price array
        └─ Filters last 90 days, converts cents → dollars
        └─ Caches result 24h in chrome.storage.local
    • FETCH_AI_VERDICT → Anthropic Claude API (claude-haiku-4-5)
        └─ Sends price stats as structured prompt
        └─ Parses JSON verdict {score, verdict, reason}
    • GET_KEYS_STATUS → chrome.storage.sync (no external call)
        │
        ▼
  content.js receives results
    • Renders Chart.js line chart (loaded dynamically from CDN)
    • Renders verdict badge + reason text
    • Writes currentPageData to chrome.storage.local
        │
        ▼
  popup.js reads chrome.storage.local
    • Displays score badge + verdict on popup click (no new API calls)
```

---

## API Keys Required

| Key | Where to get it | Cost |
|-----|-----------------|------|
| **Keepa API** | [keepa.com/#!api](https://keepa.com/#!api) | Free tier available; 1 token/minute at no cost |
| **Anthropic API** | [console.anthropic.com](https://console.anthropic.com) | Pay-per-use; claude-haiku-4-5 costs a fraction of a cent per analysis |

---

## Limitations / Known Issues

- Only supports **amazon.com** (US) in v1.0 — `.co.uk`, `.ca`, `.de`, etc. are not matched by the content script
- Supports multiple Amazon product URL patterns including `/dp/`, `/gp/product/`, and mobile `/gp/aw/d/`
- Price history is limited to the **last 90 days** of Keepa data
- Keepa's free tier has rate limits; PriceScope caches results for **24 hours** per ASIN to minimize API calls
- Chart.js is loaded from CDN on first use — requires an internet connection and may take a moment on slow connections

---

## License

MIT
