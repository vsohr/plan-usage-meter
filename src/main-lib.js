'use strict';

const fs = require('fs');
const path = require('path');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height',
  WIN_MODE_SET:  'window:set-mode',
  WIN_MODE:      'window:mode'
});

const WINDOW_WIDTH_EXPANDED = 180;
const WINDOW_WIDTH_MINIMAL  = 64;
const WINDOW_HEIGHT_DEFAULT = { expanded: 180, minimal: 132 };

function normalizeWindowMode(value) {
  return value === 'minimal' ? 'minimal' : 'expanded';
}

function widthForMode(mode) {
  return normalizeWindowMode(mode) === 'minimal'
    ? WINDOW_WIDTH_MINIMAL
    : WINDOW_WIDTH_EXPANDED;
}

function defaultHeightForMode(mode) {
  return WINDOW_HEIGHT_DEFAULT[normalizeWindowMode(mode)];
}

// Reanchors the bottom-right corner with a new (width, height). Used when the
// user toggles between expanded and minimal mode: width changes, height resets
// to a sensible placeholder, and pinnedResizeBounds takes over once the
// renderer reports its actual content height.
function modeResizeBounds(currentBounds, mode) {
  if (!currentBounds) return null;
  const width = widthForMode(mode);
  const height = defaultHeightForMode(mode);
  const right = currentBounds.x + (currentBounds.width || WINDOW_WIDTH_EXPANDED);
  const bottom = currentBounds.y + (currentBounds.height || height);
  return { x: right - width, y: bottom - height, width, height };
}

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

function clampToDisplay(state, display, width = WINDOW_WIDTH_EXPANDED, fallbackHeight = WINDOW_HEIGHT_DEFAULT.expanded) {
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
  if (Math.abs(height - currentBounds.height) <= tolerancePx) return null;
  const width = (typeof currentBounds.width === 'number' && currentBounds.width > 0)
    ? currentBounds.width
    : WINDOW_WIDTH_EXPANDED;
  return {
    x: currentBounds.x,
    y: currentBounds.y + (currentBounds.height - height),
    width,
    height
  };
}

// --- Claude OAuth token resilience -----------------------------------------
//
// The detection module (src/usage/index.js) is read-only by convention: it
// reads claudeAiOauth.accessToken and sends it to the usage API. It does NOT
// inspect expiresAt or use refreshToken — when the token expires the API
// returns HTTP 401 and Claude falls off the meter until something else (the
// Claude Code CLI itself, on its next request) rewrites the credentials file.
//
// To keep this app resilient without editing the locked detection module, the
// wrapper below performs a preflight refresh: if the token is within
// CLAUDE_TOKEN_REFRESH_LEEWAY_MS of expiring, we POST to the OAuth token
// endpoint with the refresh_token grant, atomically rewrite the credentials
// file (preserving 0600 mode), and let the existing fetchClaudeUsage call
// proceed with the freshly written access token. On a 401 from the usage API
// we force a refresh and retry once (handles the case where expiresAt was
// stale or the server invalidated the token early).

const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_TOKEN_REFRESH_LEEWAY_MS = 60_000;

function resolveClaudeCredentialsPath() {
  const home = process.env.CLAUDE_HOME ||
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude');
  return path.join(home, '.credentials.json');
}

function isClaudeTokenStale(credentials, nowMs = Date.now(), leewayMs = CLAUDE_TOKEN_REFRESH_LEEWAY_MS) {
  const oauth = credentials && credentials.claudeAiOauth;
  if (!oauth || typeof oauth.refreshToken !== 'string' || !oauth.refreshToken) return false;
  if (typeof oauth.expiresAt !== 'number') return true;
  return oauth.expiresAt - nowMs <= leewayMs;
}

async function refreshClaudeOauthCredentials(credentials, { fetchImpl = fetch, nowMs = Date.now() } = {}) {
  const refreshToken = credentials && credentials.claudeAiOauth && credentials.claudeAiOauth.refreshToken;
  if (typeof refreshToken !== 'string' || !refreshToken) {
    throw new Error('Claude refresh token not present');
  }
  const res = await fetchImpl(CLAUDE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'anthropic-beta': 'oauth-2025-04-20'
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID
    })
  });
  if (!res.ok) {
    let body = '';
    try { body = await res.text(); } catch { /* ignore */ }
    const snippet = body ? ` — ${body.slice(0, 200)}` : '';
    throw new Error(`Claude token refresh failed: HTTP ${res.status}${snippet}`);
  }
  const json = await res.json();
  const accessToken = typeof json.access_token === 'string' ? json.access_token.trim() : '';
  if (!accessToken) throw new Error('Claude token refresh returned no access_token');
  const expiresInSec = Number(json.expires_in);
  const next = { ...credentials };
  next.claudeAiOauth = {
    ...credentials.claudeAiOauth,
    accessToken,
    expiresAt: nowMs + (Number.isFinite(expiresInSec) ? expiresInSec * 1000 : 60 * 60 * 1000)
  };
  if (typeof json.refresh_token === 'string' && json.refresh_token) {
    next.claudeAiOauth.refreshToken = json.refresh_token.trim();
  }
  return next;
}

async function ensureFreshClaudeCredentials(credentialsPath, options = {}) {
  const {
    fsImpl = fs,
    fetchImpl = fetch,
    nowMs = Date.now(),
    force = false
  } = options;
  let raw;
  try {
    raw = fsImpl.readFileSync(credentialsPath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { refreshed: false, reason: 'no-credentials-file' };
    throw err;
  }
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Claude credentials file is not valid JSON: ${err.message}`);
  }
  if (!force && !isClaudeTokenStale(credentials, nowMs)) {
    return { refreshed: false, reason: 'fresh' };
  }
  const next = await refreshClaudeOauthCredentials(credentials, { fetchImpl, nowMs });
  const tmp = `${credentialsPath}.tmp`;
  fsImpl.writeFileSync(tmp, JSON.stringify(next, null, 2), { mode: 0o600 });
  fsImpl.renameSync(tmp, credentialsPath);
  return { refreshed: true, expiresAt: next.claudeAiOauth.expiresAt };
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
  WINDOW_WIDTH_EXPANDED,
  WINDOW_WIDTH_MINIMAL,
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
  modeResizeBounds,
  normalizeWindowMode,
  widthForMode,
  defaultHeightForMode,
  buildTooltip,
  CLAUDE_TOKEN_REFRESH_LEEWAY_MS,
  resolveClaudeCredentialsPath,
  isClaudeTokenStale,
  refreshClaudeOauthCredentials,
  ensureFreshClaudeCredentials
};
