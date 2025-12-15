const statusEl = document.getElementById('status');
const tabsQuery = { active: true, currentWindow: true };

function setStatus(message) {
  statusEl.textContent = message;
}

function sendMessage(payload) {
  chrome.tabs.query(tabsQuery, (tabs) => {
    if (!tabs[0]) {
      setStatus('No active tab.');
      return;
    }
    chrome.tabs.sendMessage(tabs[0].id, payload, (response) => {
      if (chrome.runtime.lastError) {
        setStatus('Content script missing.');
        return;
      }
      setStatus(response?.status ?? 'Done.');
    });
  });
}

document.getElementById('highlight').addEventListener('click', () => {
  sendMessage({ action: 'highlight' });
});

document.getElementById('reset').addEventListener('click', () => {
  sendMessage({ action: 'reset' });
});

document.getElementById('view-log').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('parent.html') });
});
