'use strict';

const fs = require('fs');

const CH = Object.freeze({
  USAGE_UPDATE:  'usage:update',
  USAGE_REFRESH: 'usage:refresh',
  WIN_HIDE:      'window:hide',
  APP_QUIT:      'app:quit',
  WIN_HEIGHT:    'window:report-height'
});

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

function buildTooltip(usage) {
  const providers = (usage && usage.providers) || {};
  const avail = Object.values(providers).filter((p) => p && p.available);
  if (avail.length === 0) return 'No providers detected';
  return avail.map((p) => p.label).join(' · ');
}

module.exports = {
  CH,
  buildTimeoutPayload,
  buildErrorPayload,
  runWithTimeout,
  readJsonSafe,
  writeJsonAtomic,
  clampToDisplay,
  buildTooltip
};
