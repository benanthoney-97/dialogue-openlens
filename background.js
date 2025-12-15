chrome.runtime.onInstalled.addListener(() => {
  console.info('[Dialogue Safety] background service worker installed');
});

chrome.runtime.onStartup.addListener(() => {
  console.info('[Dialogue Safety] background service worker started');
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message) {
    return;
  }

  if (message.type === 'log-entry') {
    const entry = message.entry;
    const details = entry.type === 'keyword'
      ? entry.keywords?.join(', ') ?? 'unknown keywords'
      : entry.text;
    const timestamp = entry.date ? `${entry.date} ${entry.time}` : entry.time;
    const suffix = entry.platform ? `(platform: ${entry.platform})` : '';
    console.info(`[Dialogue Safety] ${timestamp} ${entry.type} ${details} ${suffix}`);
    return;
  }

  if (message.type === 'activity') {
    const entry = message.entry;
    const when = entry.timestamp ? new Date(entry.timestamp).toLocaleString() : 'unknown';
    console.info(`[Dialogue Safety] last activity ${entry.platform || 'unknown'} at ${when}`);
  }
});
