'use strict';

const fs = require('fs');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});

const PROVIDER_LABELS = Object.freeze({
  codex: 'GPT --',
  claude: 'Claude --',
  hermes: 'Hermes --'
});

const AUTO_POLL_INTERVAL_MS = 10 * 60_000;
const PROVIDER_USAGE_CACHE_MS = 10 * 60_000;

function unavailableLabel(providerName) {
  return PROVIDER_LABELS[providerName] || `${providerName || 'Provider'} --`;
}

function buildUnavailableProvider(providerName, message) {
  return {
    available: false,
    source: providerName,
    label: unavailableLabel(providerName),
    message: message || 'Usage unavailable'
  };
}

function retryInText(untilMs, nowMs) {
  const remainingMs = Math.max(0, Number(untilMs) - Number(nowMs));
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `${minutes}m`;
}

function buildRateLimitedProvider(providerName, untilMs, nowMs = Date.now()) {
  return buildUnavailableProvider(providerName, `Rate limited; retrying in ${retryInText(untilMs, nowMs)}`);
}

function isHttp429Message(message) {
  return /\bHTTP\s+429\b/i.test(String(message || ''));
}

function isProviderHttp429(usage, providerName) {
  const provider = usage && usage.providers && usage.providers[providerName];
  const errors = usage && usage.errors;
  return isHttp429Message(provider && provider.message) ||
    isHttp429Message(errors && errors[providerName]);
}

function isProviderCacheFresh(cache, ttlMs, nowMs = Date.now()) {
  if (!cache || !cache.provider || typeof cache.savedAtMs !== 'number') return false;
  return nowMs - cache.savedAtMs < ttlMs;
}

function buildAccountUsagePayload({ providers, errors = {}, updatedAt } = {}) {
  const providerMap = providers || {};
  const preferred = providerMap.codex?.available ? providerMap.codex : providerMap.claude;
  return {
    available: Boolean(providerMap.codex?.available || providerMap.claude?.available),
    source: 'account-usage',
    label: preferred?.label || 'AI --',
    updatedAt: updatedAt || new Date().toISOString(),
    providers: providerMap,
    errors,
    primary: preferred?.primary || null,
    secondary: preferred?.secondary || null,
    planType: preferred?.planType || null
  };
}

function withProviderCooldown(usage, providerName, untilMs, nowMs = Date.now()) {
  const providers = { ...((usage && usage.providers) || {}) };
  const errors = { ...((usage && usage.errors) || {}) };
  providers[providerName] = buildRateLimitedProvider(providerName, untilMs, nowMs);
  errors[providerName] = `HTTP 429 (rate limited until ${new Date(untilMs).toISOString()})`;
  return buildAccountUsagePayload({
    providers,
    errors,
    updatedAt: usage && usage.updatedAt
  });
}

function buildTimeoutPayload(ms) {
  return {
    available: false,
    source: 'account-usage',
    label: 'AI --',
    updatedAt: new Date().toISOString(),
    providers: {
      codex:  { available: false, source: 'codex',  label: 'GPT --',    message: 'Provider timed out' },
      claude: { available: false, source: 'claude', label: 'Claude --', message: 'Provider timed out' }
    },
    errors: { timeout: `getAccountUsage exceeded ${ms}ms` },
    primary: null,
    secondary: null,
    planType: null
  };
}

function buildErrorPayload(err) {
  const message = (err && err.message) || String(err) || 'Unknown error';
  return {
    available: false,
    source: 'account-usage',
    label: 'AI --',
    updatedAt: new Date().toISOString(),
    providers: {
      codex:  { available: false, source: 'codex',  label: 'GPT --',    message },
      claude: { available: false, source: 'claude', label: 'Claude --', message }
    },
    errors: { fatal: message },
    primary: null,
    secondary: null,
    planType: null
  };
}

function runWithTimeout(fn, ms) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve(value);
    };
    const t = setTimeout(() => finish(buildTimeoutPayload(ms)), ms);
    Promise.resolve()
      .then(fn)
      .then(finish)
      .catch((err) => finish(buildErrorPayload(err)));
  });
}

function readJsonSafe(filePath, defaults) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (defaults === null) return parsed;
    return { ...defaults, ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn(`[persist] ${filePath}: ${err.message}`);
    return defaults === null ? null : { ...defaults };
  }
}

function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function clampToDisplay(state, display, width = 340, fallbackHeight = 200) {
  if (!state || typeof state.x !== 'number' || typeof state.y !== 'number') return null;
  if (!display || !display.workArea) return null;
  const a = display.workArea;
  const fullyOff =
    state.x + width < a.x ||
    state.x > a.x + a.width ||
    state.y + fallbackHeight < a.y ||
    state.y > a.y + a.height;
  if (fullyOff) return null;
  return { x: state.x, y: state.y, width, height: state.height || fallbackHeight };
}

function selectDefaultDisplay(displays, primaryDisplay = null) {
  const candidates = Array.isArray(displays) && displays.length > 0 ? displays : [primaryDisplay];
  return candidates
    .filter((d) => d && d.workArea)
    .sort((a, b) => (b.workArea.x + b.workArea.width) - (a.workArea.x + a.workArea.width))[0] || null;
}

function pinnedResizeBounds(currentBounds, nextHeight, tolerancePx = 1) {
  if (!currentBounds || typeof currentBounds.height !== 'number') return null;
  const height = Math.round(Number(nextHeight) || 0);
  if (height <= currentBounds.height + tolerancePx) return null;
  return {
    x: currentBounds.x,
    y: currentBounds.y + (currentBounds.height - height),
    width: 340,
    height
  };
}

function buildTooltip(usage) {
  const providers = (usage && usage.providers) || {};
  const avail = Object.values(providers).filter((p) => p && p.available);
  if (avail.length === 0) return 'No providers detected';
  return avail.map((p) => p.label).join(' · ');
}

module.exports = {
  CH,
  AUTO_POLL_INTERVAL_MS,
  PROVIDER_USAGE_CACHE_MS,
  buildTimeoutPayload,
  buildErrorPayload,
  runWithTimeout,
  buildAccountUsagePayload,
  buildUnavailableProvider,
  buildRateLimitedProvider,
  isProviderCacheFresh,
  isProviderHttp429,
  withProviderCooldown,
  readJsonSafe,
  writeJsonAtomic,
  clampToDisplay,
  selectDefaultDisplay,
  pinnedResizeBounds,
  buildTooltip
};
