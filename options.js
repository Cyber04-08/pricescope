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

  // Route through background service worker — hits Keepa directly,
  // bypassing the cache and demo-mode fallback so the result is honest
  const result = await chrome.runtime.sendMessage({ type: 'TEST_KEEPA_KEY', key });

  if (result.ok) {
    keepaStatus.textContent = '✓ Connected';
    keepaStatus.style.color = '#007600';
  } else {
    keepaStatus.textContent = `✗ Failed (${result.status || result.error || 'network error'})`;
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

  // Route through background service worker (more reliable in MV3)
  const result = await chrome.runtime.sendMessage({ type: 'TEST_CLAUDE_KEY', key });

  if (result.ok) {
    claudeStatus.textContent = '✓ Connected';
    claudeStatus.style.color = '#007600';
  } else {
    claudeStatus.textContent = `✗ Failed (${result.status || result.error || 'network error'})`;
    claudeStatus.style.color = '#c40000';
  }
});
