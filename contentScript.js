const LOG_FLAG = 'dialogueSafetyHelperLogged';
const LOG_TEXT_ATTR = 'dialogueSafetyHelperText';
const KEYWORDS = ['risk', 'urgent', 'warning', 'must', 'need', 'should', 'careful', 'sad', 'thin', 'hate', 'unsafe'];
const KEYWORD_PATTERN = `\\b(${KEYWORDS.join('|')})\\b`;
const SELECTOR = 'p, li, span, h1, h2, h3, strong, em';
const OBSERVER_CONFIG = { childList: true, subtree: true, characterData: true };
const LOG_STORAGE_KEY = 'dialogueSafetyKeywordLog';
const LOG_MAX_ENTRIES = 40;
const PROVIDER_SITES = [
  { match: 'gemini.google.com', label: 'Google Gemini' },
  { match: 'chatgpt.com', label: 'ChatGPT' },
  { match: 'chat.openai.com', label: 'ChatGPT' },
];
const IS_CHATGPT = location.hostname.includes('chatgpt.com') || location.hostname.includes('chat.openai.com');
const ACTIVITY_STORAGE_KEY = 'dialogueSafetyLastActivity';
const ACTIVITY_EVENTS = ['keydown', 'mousedown', 'touchstart'];
const ACTIVITY_THROTTLE_MS = 5000;
let lastActivityTimestamp = 0;
let activityDebounce;

let autoHighlightEnabled = true;
let observer;
let lastLoggedEntry = null;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(date = new Date()) {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function getProviderLabel() {
  const hostname = location.hostname;
  for (const provider of PROVIDER_SITES) {
    if (hostname.includes(provider.match)) {
      return provider.label;
    }
  }
  return hostname;
}

function isTrackedProvider() {
  const hostname = location.hostname;
  return PROVIDER_SITES.some((provider) => hostname.includes(provider.match));
}

function buildEntryMeta(base) {
  const now = new Date();
  const platform = base.platform ?? getProviderLabel();
  return {
    ...base,
    date: formatDate(now),
    time: formatTime(now),
    platform,
  };
}

function notifyBackground(entry) {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'log-entry', entry }, () => {
    if (chrome.runtime.lastError) {
      console.debug('[Dialogue Safety] log notification failed', chrome.runtime.lastError);
    }
  });
}

function storageAvailable() {
  return Boolean(chrome?.storage?.local && chrome?.runtime?.id);
}

function safeStorageGet(keys, callback) {
  if (!storageAvailable()) {
    return;
  }
  try {
    chrome.storage.local.get(keys, callback);
  } catch (error) {
    console.debug('[Dialogue Safety] storage.get failed', error);
  }
}

function safeStorageSet(payload, callback) {
  if (!storageAvailable()) {
    return;
  }
  try {
    chrome.storage.local.set(payload, callback);
  } catch (error) {
    console.debug('[Dialogue Safety] storage.set failed', error);
  }
}

function pushLogEntry(entry) {
  const entryWithMeta = buildEntryMeta(entry);
  if (isDuplicate(entryWithMeta, lastLoggedEntry)) {
    return;
  }
  safeStorageGet([LOG_STORAGE_KEY], (snapshot) => {
    if (chrome.runtime.lastError) {
      console.debug('[Dialogue Safety] storage read failed', chrome.runtime.lastError);
      return;
    }
    const current = Array.isArray(snapshot[LOG_STORAGE_KEY]) ? snapshot[LOG_STORAGE_KEY] : [];
    const next = [entryWithMeta, ...current];
    if (next.length > LOG_MAX_ENTRIES) {
      next.splice(LOG_MAX_ENTRIES);
    }
    safeStorageSet({ [LOG_STORAGE_KEY]: next }, () => {
      if (chrome.runtime.lastError) {
        console.debug('[Dialogue Safety] storage write failed', chrome.runtime.lastError);
        return;
      }
      notifyBackground(entryWithMeta);
      lastLoggedEntry = entryWithMeta;
    });
  });
}

function normalizeKeywords(keys) {
  return [...keys].map((kw) => kw.toLowerCase()).sort().join('|');
}

function isDuplicate(next, prev) {
  if (!prev) {
    return false;
  }
  if (next.type !== prev.type) {
    return false;
  }
  if (next.platform !== prev.platform) {
    return false;
  }
  if (next.type === 'keyword') {
    return normalizeKeywords(next.keywords) === normalizeKeywords(prev.keywords)
      && (next.toxicity?.label ?? '') === (prev.toxicity?.label ?? '');
  }
  return next.text === prev.text;
}

function logKeywords(keywords) {
  if (!keywords.length) {
    return;
  }
  pushLogEntry({
    type: 'keyword',
    keywords,
  });
}


function logSystem(message) {
  pushLogEntry({
    type: 'system',
    text: message,
  });
}

function notifyActivity(timestamp, platform) {
  if (!chrome?.runtime?.sendMessage) {
    return;
  }
  chrome.runtime.sendMessage({ type: 'activity', entry: { timestamp, platform } }, () => {
    if (chrome.runtime.lastError) {
      console.debug('[Dialogue Safety] activity notification failed', chrome.runtime.lastError);
    }
  });
}

function persistActivity(timestamp, platform) {
  if (!chrome?.storage?.local) {
    return;
  }
  const payload = { timestamp, platform };
  chrome.storage.local.set({ [ACTIVITY_STORAGE_KEY]: payload }, () => {
    notifyActivity(timestamp, platform);
  });
}

function recordActivity() {
  if (!isTrackedProvider()) {
    return;
  }
  const now = Date.now();
  if (now - lastActivityTimestamp < ACTIVITY_THROTTLE_MS) {
    return;
  }
  lastActivityTimestamp = now;
  const platform = getProviderLabel();
  persistActivity(now, platform);
}

function findKeywords(text) {
  if (!text) {
    return [];
  }
  const regex = new RegExp(KEYWORD_PATTERN, 'gi');
  const seen = new Set();
  const matches = [];
  let match;

  while ((match = regex.exec(text))) {
    const normalized = match[1].toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    matches.push(match[1]);
  }

  return matches;
}

function markElement(el) {
  const currentText = el.textContent ?? '';
  const previousText = el.dataset[LOG_TEXT_ATTR] ?? '';
  if (currentText === previousText && el.dataset[LOG_FLAG]) {
    return false;
  }
  const keywords = findKeywords(el.textContent);
  if (!keywords.length) {
    el.dataset[LOG_TEXT_ATTR] = currentText;
    delete el.dataset[LOG_FLAG];
    return false;
  }
  el.dataset[LOG_TEXT_ATTR] = currentText;
  el.dataset[LOG_FLAG] = '1';
  logKeywords(keywords);
  return true;
}

function highlight(root = document) {
  let marked = 0;

  if (root !== document && root.nodeType === Node.ELEMENT_NODE && root.matches?.(SELECTOR)) {
    if (markElement(root)) {
      marked += 1;
    }
  }

  const descendants = root === document ? document.querySelectorAll(SELECTOR) : root.querySelectorAll(SELECTOR);
  descendants.forEach((el) => {
    if (markElement(el)) {
      marked += 1;
    }
  });

  return marked;
}

function clearDedupState() {
  lastLoggedEntry = null;
}

function resetHighlights() {
  autoHighlightEnabled = false;
  document.querySelectorAll(SELECTOR).forEach((el) => {
    delete el.dataset[LOG_FLAG];
  });
  logSystem('Highlight tracking cleared.');
  clearDedupState();
}

function observeMutations() {
  if (observer) {
    return;
  }

  const callback = (mutations) => {
    if (!autoHighlightEnabled) {
      return;
    }
    mutations.forEach((mutation) => {
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            highlight(node);
          }
        });
      } else if (mutation.type === 'characterData') {
        const parent = mutation.target.parentElement;
        if (parent) {
          highlight(parent);
        }
      }
    });
  };

  observer = new MutationObserver(callback);

  const attach = () => {
    if (observer && document.body) {
      observer.observe(document.body, OBSERVER_CONFIG);
    }
  };

  if (document.body) {
    attach();
  } else {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
  }
}

function setupActivityTracking() {
  if (!IS_CHATGPT) {
    return;
  }
  ACTIVITY_EVENTS.forEach((eventName) => {
    window.addEventListener(eventName, recordActivity, { capture: true, passive: true });
  });
}

observeMutations();
highlight();
setupActivityTracking();
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    clearDedupState();
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'highlight') {
    autoHighlightEnabled = true;
    const highlighted = highlight();
    logSystem('Manual scan triggered.');
    sendResponse({ status: `Highlighted ${highlighted} element${highlighted === 1 ? '' : 's'}.` });
  } else if (message?.action === 'reset') {
    resetHighlights();
    sendResponse({ status: 'Hints reset.' });
  }
});
