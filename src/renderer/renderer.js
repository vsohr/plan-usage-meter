'use strict';

let latestUsage = null;
let renderRaf = null;
let refreshInFlight = false;

const PROVIDER_DISPLAY_NAMES = {
  claude: 'Claude',
  codex:  'Codex',
  hermes: 'Hermes'
};

const PROVIDER_ORDER = ['claude', 'codex'];

function providerOrderedKeys(providers) {
  const keys = Object.keys(providers || {});
  const head = PROVIDER_ORDER.filter((k) => keys.includes(k));
  const tail = keys.filter((k) => !PROVIDER_ORDER.includes(k));
  return [...head, ...tail];
}

function el(tag, opts) {
  const node = document.createElement(tag);
  if (!opts) return node;
  if (opts.className) node.className = opts.className;
  if (opts.text != null) node.textContent = String(opts.text);
  return node;
}

function buildWindowRow(w) {
  if (!w || typeof w.usedPercent !== 'number') return null;
  const pct = Math.round(clampPercent(w.usedPercent));
  const cls = thresholdClass(w.usedPercent);
  const reset = formatResetIn(w.resetsAt);
  const pctText = Number.isFinite(w.usedPercent) ? `${pct}%` : '—';

  const row = el('div', { className: 'row' });
  const label = el('div', { className: 'label' });
  label.appendChild(el('span', { text: w.label || 'Usage' }));
  label.appendChild(el('span', { text: `${pctText} · ${reset}` }));
  const bar = el('div', { className: cls ? `bar ${cls}` : 'bar' });
  const fill = el('div', { className: 'fill' });
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  row.appendChild(label);
  row.appendChild(bar);
  return row;
}

function buildCard(name, provider) {
  const display = PROVIDER_DISPLAY_NAMES[name] || name;
  const card = el('article', { className: 'card' });
  const head = el('div', { className: 'head' });
  head.appendChild(el('span', { className: 'name', text: display }));

  if (!provider || provider.available !== true) {
    card.classList.add('unavailable');
    head.appendChild(el('span', { className: 'plan', text: 'Not detected' }));
    card.appendChild(head);
    card.appendChild(el('div', { className: 'message', text: provider?.message || 'Not detected' }));
    return card;
  }

  head.appendChild(el('span', { className: 'plan', text: provider.planType || 'Plan' }));
  card.appendChild(head);

  const rows = [
    buildWindowRow(provider.primary),
    buildWindowRow(provider.secondary),
    ...(provider.details || []).map(buildWindowRow)
  ].filter(Boolean);
  for (const row of rows) card.appendChild(row);
  return card;
}

function renderCards(usage) {
  const root = document.getElementById('cards');
  if (!root) return;
  // Build the new DOM tree first, then replace in a single mutation.
  // Single-mutation replacement keeps the resize flicker-free (AC24).
  const next = document.createDocumentFragment();
  if (!usage || !usage.providers) {
    const placeholder = el('article', { className: 'card unavailable' });
    const head = el('div', { className: 'head' });
    head.appendChild(el('span', { className: 'name', text: 'Plan Usage Meter' }));
    head.appendChild(el('span', { className: 'plan', text: 'loading…' }));
    placeholder.appendChild(head);
    next.appendChild(placeholder);
  } else {
    for (const k of providerOrderedKeys(usage.providers)) {
      next.appendChild(buildCard(k, usage.providers[k]));
    }
  }
  root.replaceChildren(next);
}

function reportHeight() {
  if (!window.api || typeof window.api.reportHeight !== 'function') return;
  // documentElement.scrollHeight tracks content height including the header.
  // +1 px guard against sub-pixel jitter at fractional DPI scales (AC24).
  const h = document.documentElement.scrollHeight + 1;
  window.api.reportHeight(h);
}

function scheduleRender() {
  if (renderRaf) return;
  renderRaf = requestAnimationFrame(() => {
    renderRaf = null;
    renderCards(latestUsage);
    reportHeight();
  });
}

function setRefreshSpinning(active) {
  const btn = document.getElementById('refresh');
  if (!btn) return;
  btn.classList.toggle('spinning', !!active);
  btn.disabled = !!active;
}

document.addEventListener('DOMContentLoaded', () => {
  if (!window.api) {
    console.warn('[renderer] preload bridge missing');
    return;
  }

  window.api.onUsage((usage) => {
    latestUsage = usage;
    refreshInFlight = false;
    setRefreshSpinning(false);
    scheduleRender();
  });

  document.getElementById('refresh').addEventListener('click', async () => {
    if (refreshInFlight) return;
    refreshInFlight = true;
    setRefreshSpinning(true);
    try {
      const res = await window.api.refreshNow();
      if (!res || res.accepted === false) {
        // Another poll is already in flight; clear spinner shortly so the user
        // sees the click registered without leaving it stuck.
        setTimeout(() => { refreshInFlight = false; setRefreshSpinning(false); }, 500);
      }
      // If accepted, the next 'usage:update' broadcast clears the spinner.
    } catch (err) {
      console.warn('[renderer] refresh failed', err);
      refreshInFlight = false;
      setRefreshSpinning(false);
    }
  });

  document.getElementById('close').addEventListener('click', () => window.api.hide());

  // Relative-time tick: re-render every 30s without re-polling (F2/AC18).
  setInterval(() => { if (latestUsage) scheduleRender(); }, 30_000);

  scheduleRender();
});
