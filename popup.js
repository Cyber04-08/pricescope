// PriceScope Popup Script

function openSettings() {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
}

document.getElementById('open-settings').addEventListener('click', (e) => {
  e.preventDefault();
  openSettings();
});

document.getElementById('open-settings-btn').addEventListener('click', openSettings);

async function init() {
  const noDataEl = document.getElementById('no-data-state');
  const noKeysEl = document.getElementById('no-keys-state');
  const dataEl = document.getElementById('data-state');

  // 1. Check whether keys are configured
  const keysStatus = await chrome.runtime.sendMessage({ type: 'GET_KEYS_STATUS' });

  if (!keysStatus.hasKeepaKey || !keysStatus.hasClaudeKey) {
    noKeysEl.classList.remove('hidden');
    return;
  }

  // 2. Read cached page data
  const stored = await chrome.storage.local.get('currentPageData');
  const data = stored.currentPageData;

  // Show no-data if missing or stale (> 5 minutes)
  if (!data || Date.now() - data.timestamp > 5 * 60 * 1000) {
    noDataEl.classList.remove('hidden');
    return;
  }

  // 3. Populate data state
  const { asin, currentPrice, verdict } = data;

  document.getElementById('popup-asin').textContent = `ASIN: ${asin}`;
  document.getElementById('popup-price').textContent = `Current Price: $${currentPrice.toFixed(2)}`;

  const score = verdict.score;
  const badge = document.getElementById('popup-score-badge');
  badge.textContent = `${score}/10`;
  if (score <= 3) badge.classList.add('score-low');
  else if (score <= 6) badge.classList.add('score-mid');
  else badge.classList.add('score-high');

  document.getElementById('popup-verdict-text').textContent = verdict.verdict;
  document.getElementById('popup-reason').textContent = verdict.reason;

  dataEl.classList.remove('hidden');
}

init();
