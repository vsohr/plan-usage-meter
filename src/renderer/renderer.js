'use strict';

let latestUsage = null;
let renderRaf = null;
let refreshInFlight = false;
let currentMode = 'expanded';

const PROVIDER_DISPLAY_NAMES = {
  claude: 'Claude',
  codex:  'Codex',
  hermes: 'Hermes'
};

const PROVIDER_ORDER = ['claude', 'codex'];
const HIDDEN_WINDOW_LABELS = new Set(['Sonnet weekly']);

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

function providerIcon(name) {
  const meta = providerIconMeta(name);
  if (!meta) return null;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const span = el('span', { className: meta.className });
  span.setAttribute('aria-hidden', 'true');
  const svg = document.createElementNS(SVG_NS, 'svg');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${meta.symbolId}`);
  svg.appendChild(use);
  span.appendChild(svg);
  return span;
}

function buildWindowRow(w) {
  if (!w || typeof w.usedPercent !== 'number') return null;
  const pct = Math.round(clampPercent(w.usedPercent));
  const cls = thresholdClass(w.usedPercent);
  // formatResetIn returns "resets in 5d 3h" / "resets soon" / "—"; the prefix
  // is redundant alongside the "Weekly · 47% · ..." context and overflows the
  // narrower 180-px expanded width — strip it inline so the bare duration shows.
  const reset = formatResetIn(w.resetsAt).replace(/^resets\s+/, '');
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

function visibleWindows(windows) {
  return (windows || []).filter((w) => w && !HIDDEN_WINDOW_LABELS.has(w.label));
}

function buildCard(name, provider) {
  const display = PROVIDER_DISPLAY_NAMES[name] || name;
  const card = el('article', { className: 'card' });
  const head = el('div', { className: 'head' });
  const title = el('span', { className: 'name' });
  const icon = providerIcon(name);
  if (icon) title.appendChild(icon);
  title.appendChild(el('span', { text: display }));
  head.appendChild(title);

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
    ...visibleWindows(provider.details).map(buildWindowRow)
  ].filter(Boolean);
  for (const row of rows) card.appendChild(row);
  return card;
}

function renderExpanded(usage) {
  const root = document.getElementById('cards');
  if (!root) return;
  // Build the new DOM tree first, then replace in a single mutation.
  // Single-mutation replacement keeps the resize flicker-free (AC24).
  const next = document.createDocumentFragment();
  if (!usage || !usage.providers) {
    const placeholder = el('article', { className: 'card unavailable' });
    const head = el('div', { className: 'head' });
    head.appendChild(el('span', { className: 'name', text: 'Plan Usage' }));
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

function buildChipRow(label, w) {
  const row = el('div', { className: 'chip-row' });
  row.appendChild(el('span', { className: 'chip-label', text: label }));

  const hasPct = w && typeof w.usedPercent === 'number' && Number.isFinite(w.usedPercent);
  // thresholdClass returns '' for <65 (its tests assert that). The chip wants
  // green for the under-threshold band, so map empty → 'ok' here only.
  const cls = hasPct ? (thresholdClass(w.usedPercent) || 'ok') : '';
  const pctText = hasPct ? `${Math.round(clampPercent(w.usedPercent))}%` : '——';
  row.appendChild(el('span', {
    className: cls ? `chip-percent ${cls}` : 'chip-percent',
    text: pctText
  }));
  return row;
}

function buildChipSection(providerName, provider) {
  // Provider slot semantics (src/usage/index.js): primary = 5-hour / Session
  // window, secondary = 7-day / Weekly window. Both Claude and Codex fill
  // these slots so the chip layout is symmetric across providers.
  const available = !!(provider && provider.available === true);
  const section = el('div', { className: available ? 'chip-section' : 'chip-section unavailable' });
  if (refreshInFlight) section.classList.add('refreshing');

  const iconMeta = providerIconMeta(providerName);
  if (iconMeta) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const span = el('span', { className: iconMeta.className });
    span.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS(SVG_NS, 'svg');
    const use = document.createElementNS(SVG_NS, 'use');
    use.setAttribute('href', `#${iconMeta.symbolId}`);
    svg.appendChild(use);
    span.appendChild(svg);
    section.appendChild(span);
  }

  const rows = el('div', { className: 'chip-rows' });
  // 5hr on top, weekly below — fixed order regardless of provider.
  rows.appendChild(buildChipRow('5h', available ? provider.primary   : null));
  rows.appendChild(buildChipRow('Wk', available ? provider.secondary : null));
  section.appendChild(rows);
  return section;
}

function renderMinimal(usage) {
  const root = document.getElementById('cards');
  if (!root) return;
  const providers = (usage && usage.providers) || {};
  const chip = el('div', { className: 'chip' });

  chip.appendChild(buildChipSection('claude', providers.claude));
  chip.appendChild(el('div', { className: 'chip-divider' }));
  chip.appendChild(buildChipSection('codex',  providers.codex));

  const next = document.createDocumentFragment();
  next.appendChild(chip);
  root.replaceChildren(next);
}

function renderCards(usage) {
  if (currentMode === 'minimal') renderMinimal(usage);
  else renderExpanded(usage);
}

function renderRefreshMeta(usage) {
  const meta = document.getElementById('refresh-meta');
  if (!meta) return;
  meta.textContent = formatRefreshMeta(usage);
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
    renderRefreshMeta(latestUsage);
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

function applyModeClass() {
  document.body.classList.toggle('mode-minimal', currentMode === 'minimal');
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

  if (typeof window.api.onMode === 'function') {
    window.api.onMode((mode) => {
      currentMode = (mode === 'minimal') ? 'minimal' : 'expanded';
      applyModeClass();
      scheduleRender();
    });
  }

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

  const minimiseBtn = document.getElementById('minimise');
  if (minimiseBtn) {
    minimiseBtn.addEventListener('click', () => {
      if (window.api && typeof window.api.setMode === 'function') {
        window.api.setMode('minimal');
      }
    });
  }

  const expandBtn = document.getElementById('expand');
  if (expandBtn) {
    expandBtn.addEventListener('click', (e) => {
      // Stop the bubble so the #cards click-to-expand handler doesn't double-fire.
      e.stopPropagation();
      if (window.api && typeof window.api.setMode === 'function') {
        window.api.setMode('expanded');
      }
    });
  }

  applyModeClass();

  // Relative-time tick: re-render every 30s without re-polling (F2/AC18).
  setInterval(() => { if (latestUsage) scheduleRender(); }, 30_000);

  scheduleRender();
});
