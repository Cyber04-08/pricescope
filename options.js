// PriceScope Options Script

const keepaInput = document.getElementById('keepa-key');
const claudeInput = document.getElementById('claude-key');
const keepaStatus = document.getElementById('keepa-status');
const claudeStatus = document.getElementById('claude-status');
const saveConfirm = document.getElementById('save-confirm');

// ─── Load saved keys on open ───────────────────────────────────────────────

async function loadKeys() {
  const { keepaKey, claudeKey } = await chrome.storage.sync.get(['keepaKey', 'claudeKey']);
  if (keepaKey) keepaInput.value = keepaKey;
  if (claudeKey) claudeInput.value = claudeKey;
}

loadKeys();

// ─── Save button ───────────────────────────────────────────────────────────

document.getElementById('save-btn').addEventListener('click', async () => {
  const keepaKey = keepaInput.value.trim();
  const claudeKey = claudeInput.value.trim();

  await chrome.storage.sync.set({ keepaKey, claudeKey });

  saveConfirm.classList.remove('hidden');
  setTimeout(() => saveConfirm.classList.add('hidden'), 2000);
});

// ─── Test Keepa ────────────────────────────────────────────────────────────

document.getElementById('test-keepa').addEventListener('click', async () => {
  const key = keepaInput.value.trim();
  if (!key) {
    keepaStatus.textContent = '✗ Please enter a key first.';
    keepaStatus.style.color = '#c40000';
    return;
  }

  keepaStatus.textContent = 'Testing…';
  keepaStatus.style.color = '#565959';

  // Temporarily save the key so background.js can use it
  await chrome.storage.sync.set({ keepaKey: key });

  const result = await chrome.runtime.sendMessage({
    type: 'FETCH_PRICE_DATA',
    asin: 'B08N5WRWNW' // Echo Dot test ASIN
  });

  if (result.success) {
    keepaStatus.textContent = '✓ Connected';
    keepaStatus.style.color = '#007600';
  } else {
    keepaStatus.textContent = '✗ Invalid key or network error';
    keepaStatus.style.color = '#c40000';
  }
});

// ─── Test Claude ───────────────────────────────────────────────────────────

document.getElementById('test-claude').addEventListener('click', async () => {
  const key = claudeInput.value.trim();
  if (!key) {
    claudeStatus.textContent = '✗ Please enter a key first.';
    claudeStatus.style.color = '#c40000';
    return;
  }

  claudeStatus.textContent = 'Testing…';
  claudeStatus.style.color = '#565959';

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Reply with the single word: ok' }]
      })
    });

    if (response.ok) {
      claudeStatus.textContent = '✓ Connected';
      claudeStatus.style.color = '#007600';
    } else {
      claudeStatus.textContent = '✗ Invalid key or network error';
      claudeStatus.style.color = '#c40000';
    }
  } catch {
    claudeStatus.textContent = '✗ Invalid key or network error';
    claudeStatus.style.color = '#c40000';
  }
});
