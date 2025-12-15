const STORAGE_KEY = 'dialogueSafetyKeywordLog';
let entriesRoot;

function createKeywordsHTML(keywords) {
  return keywords
    .map((word) => `<span>${word}</span>`)
    .join('');
}

function renderEntries(entries) {
  if (!entriesRoot) {
    return;
  }
  if (!entries || !entries.length) {
    entriesRoot.innerHTML = '<div class="empty-state">No keywords logged yet.</div>';
    return;
  }
  entriesRoot.innerHTML = entries.map(renderEntry).join('');
}

function renderEntry(entry) {
  const meta = renderMeta(entry);
  if (entry.type === 'keyword') {
    return `
      <article class="entry">
        ${meta}
        <div class="keywords">${createKeywordsHTML(entry.keywords)}</div>
        ${renderClassification(entry)}
      </article>
    `;
  }
  return `
    <article class="entry system">
      ${meta}
      <div class="keywords">${entry.text}</div>
    </article>
  `;
}

function renderClassification(entry) {
  const { toxicity } = entry;
  if (!toxicity || !toxicity.label) {
    return '';
  }
  const confidence = (toxicity.score ?? 0) * 100;
  return `
    <div class="classification">
      <span class="classification-label">${toxicity.label}</span>
      <span class="classification-score">${confidence.toFixed(1)}%</span>
    </div>
  `;
}

function renderMeta(entry) {
  const timeLabel = entry.date ? `${entry.date} · ${entry.time}` : entry.time;
const platformLabel = entry.platform ?? entry.source;
const sourceLabel = platformLabel ? `<span class="source">${platformLabel}</span>` : '';
  return `
    <div class="meta">
      <span class="time">${timeLabel}</span>
      ${sourceLabel}
    </div>
  `;
}

function updateLog() {
  if (!chrome?.storage?.local) {
    return;
  }
  if (!entriesRoot) {
    return;
  }
  chrome.storage.local.get([STORAGE_KEY], (snapshot) => {
    renderEntries(snapshot[STORAGE_KEY] || []);
  });
}

const navButtons = Array.from(document.querySelectorAll('.sidebar-item'));
const panels = Array.from(document.querySelectorAll('[data-view-panel]'));
const PANEL_ICON = document.querySelector('.panel-icon');
const guardrailsView = document.querySelector('.guardrails-view');
const guardrailCards = Array.from(document.querySelectorAll('.guardrail-card'));
const keywordsForm = document.querySelector('[data-keywords-form]');
const keywordsChips = document.querySelector('[data-keywords-chips]');
const KEYWORDS_STORAGE = 'dialogueSafetyParentKeywords';
const STATUS_ACTIVITY_KEY = 'dialogueSafetyLastActivity';
const statusTimeEl = document.querySelector('[data-status-time]');

function loadKeywords() {
  const raw = localStorage.getItem(KEYWORDS_STORAGE);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveKeywords(list) {
  localStorage.setItem(KEYWORDS_STORAGE, JSON.stringify(list));
}

function renderKeywords(list) {
  if (!keywordsChips) {
    return;
  }
  keywordsChips.innerHTML = '';
  list.forEach((keyword) => {
    const chip = document.createElement('span');
    chip.textContent = keyword;
    keywordsChips.appendChild(chip);
  });
}

function addKeyword(keyword) {
  const trimmed = keyword.trim();
  if (!trimmed) {
    return;
  }
  const current = loadKeywords();
  const next = [...current, trimmed];
  saveKeywords(next);
  renderKeywords(next);
}

function formatActivity(entry) {
  if (!entry || !entry.timestamp) {
    return 'Last activity: none';
  }
  const date = new Date(entry.timestamp);
  const label = entry.platform || 'Activity';
  return `Last activity (${label}): ${date.toLocaleString()}`;
}

function updateStatusActivityDisplay(entry) {
  if (!statusTimeEl) {
    return;
  }
  statusTimeEl.textContent = formatActivity(entry);
}
let expandedCard = null;

function collapseExpandedCard() {
  if (!expandedCard) {
    return;
  }
  expandedCard.classList.remove('is-expanded');
  if (guardrailsView) {
    guardrailsView.classList.remove('is-expanded');
  }
  expandedCard = null;
}

function expandGuardrailCard(card) {
  if (expandedCard === card) {
    return;
  }
  collapseExpandedCard();
  card.classList.add('is-expanded');
  if (guardrailsView) {
    guardrailsView.classList.add('is-expanded');
  }
  expandedCard = card;
}

function loadLastActivity() {
  if (!chrome?.storage?.local) {
    return;
  }
  chrome.storage.local.get([STATUS_ACTIVITY_KEY], (snapshot) => {
    updateStatusActivityDisplay(snapshot[STATUS_ACTIVITY_KEY]);
  });
}

function setActiveView(view) {
  navButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  panels.forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.viewPanel === view);
  });
  if (view === 'guardrails') {
    collapseExpandedCard();
    if (SECTION_TITLE) {
      SECTION_TITLE.textContent = 'Guardrails';
    }
    if (PANEL_ICON) {
      PANEL_ICON.classList.add('visible');
    }
    return;
  }
  if (PANEL_ICON) {
    PANEL_ICON.classList.remove('visible');
  }
  if (view === 'status') {
    if (SECTION_TITLE) {
      SECTION_TITLE.textContent = 'Status';
    }
  } else if (view === 'feed' || view === 'log') {
    if (SECTION_TITLE) {
      SECTION_TITLE.textContent = 'Live keyword log';
    }
    updateLog();
  }
}

let SECTION_TITLE;

document.addEventListener('DOMContentLoaded', () => {
  entriesRoot = document.getElementById('entries');
  SECTION_TITLE = document.querySelector('.panel-header h2');
  navButtons.forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.view));
  });
  guardrailCards.forEach((card) => {
    card.addEventListener('click', () => expandGuardrailCard(card));
    const closeButton = card.querySelector('.guardrail-close');
    closeButton?.addEventListener('click', (event) => {
      event.stopPropagation();
      collapseExpandedCard();
    });
  });
  updateLog();
  setActiveView('status');
  renderKeywords(loadKeywords());
  keywordsForm?.addEventListener('click', (event) => event.stopPropagation());
  keywordsForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const input = keywordsForm.querySelector('input[name="keyword"]');
    if (input) {
      addKeyword(input.value);
      input.value = '';
    }
  });
  loadLastActivity();
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes[STORAGE_KEY]) {
    renderEntries(changes[STORAGE_KEY].newValue || []);
  }
  if (changes[STATUS_ACTIVITY_KEY]) {
    updateStatusActivityDisplay(changes[STATUS_ACTIVITY_KEY].newValue);
  }
});
