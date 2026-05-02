'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
} = require('../src/main-lib');

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

// --- CH ----------------------------------------------------------------------

test('CH: channel constants exist and are frozen', () => {
  assert.strictEqual(CH.USAGE_UPDATE, 'usage:update');
  assert.strictEqual(CH.USAGE_REFRESH, 'usage:refresh');
  assert.strictEqual(CH.WIN_HIDE, 'window:hide');
  assert.strictEqual(CH.APP_QUIT, 'app:quit');
  assert.strictEqual(CH.WIN_HEIGHT, 'window:report-height');
  assert.ok(Object.isFrozen(CH));
});

test('usage cadence constants keep providers on a five-minute window', () => {
  assert.strictEqual(AUTO_POLL_INTERVAL_MS, 5 * 60_000);
  assert.strictEqual(PROVIDER_USAGE_CACHE_MS, 5 * 60_000);
});

// --- clampToDisplay ----------------------------------------------------------

test('clampToDisplay: null state returns null', () => {
  assert.strictEqual(clampToDisplay(null, display), null);
});

test('clampToDisplay: missing x or y returns null', () => {
  assert.strictEqual(clampToDisplay({ y: 100 }, display), null);
  assert.strictEqual(clampToDisplay({ x: 100 }, display), null);
});

test('clampToDisplay: in-bounds returns identity', () => {
  const r = clampToDisplay({ x: 100, y: 100, width: 340, height: 200 }, display);
  assert.deepStrictEqual(r, { x: 100, y: 100, width: 340, height: 200 });
});

test('clampToDisplay: off-screen left returns null (fallback object)', () => {
  assert.strictEqual(clampToDisplay({ x: -5000, y: 100, height: 200 }, display), null);
});

test('clampToDisplay: off-screen right returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 5000, y: 100, height: 200 }, display), null);
});

test('clampToDisplay: off-screen top returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: -5000, height: 200 }, display), null);
});

test('clampToDisplay: off-screen bottom returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: 5000, height: 200 }, display), null);
});

test('clampToDisplay: partial overlap is preserved (kept in bounds via parent fallback)', () => {
  // The implementation considers any non-fully-off state in-bounds and returns
  // the original coords; main.js uses defaultBottomRight as the off-screen fallback.
  const r = clampToDisplay({ x: 1900, y: 1000, height: 200 }, display);
  assert.ok(r);
  assert.strictEqual(r.x, 1900);
  assert.strictEqual(r.y, 1000);
});

test('clampToDisplay: width forced to 340', () => {
  const r = clampToDisplay({ x: 50, y: 50, width: 999, height: 200 }, display);
  assert.strictEqual(r.width, 340);
});

test('clampToDisplay: missing height defaults to 200', () => {
  const r = clampToDisplay({ x: 50, y: 50 }, display);
  assert.strictEqual(r.height, 200);
});

test('clampToDisplay: null display returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: 100, height: 200 }, null), null);
});

test('clampToDisplay: single-display happy path (bottom-right within work area)', () => {
  const r = clampToDisplay(
    { x: 1564, y: 824, width: 340, height: 200 },
    display
  );
  assert.deepStrictEqual(r, { x: 1564, y: 824, width: 340, height: 200 });
});

test('selectDefaultDisplay: picks the rightmost display for first launch', () => {
  const displays = [
    { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } },
    { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1400 } }
  ];
  assert.strictEqual(selectDefaultDisplay(displays), displays[1]);
});

test('selectDefaultDisplay: falls back to primary when no display list exists', () => {
  const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
  assert.strictEqual(selectDefaultDisplay([], primary), primary);
  assert.strictEqual(selectDefaultDisplay(null, primary), primary);
});

test('pinnedResizeBounds: ignores one-pixel resize jitter', () => {
  assert.strictEqual(pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 301), null);
  assert.strictEqual(pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 299), null);
});

test('pinnedResizeBounds: keeps the current height when content reports smaller', () => {
  assert.strictEqual(pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 240), null);
});

test('pinnedResizeBounds: pins bottom edge for real height changes', () => {
  assert.deepStrictEqual(
    pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 320),
    { x: 10, y: 0, width: 340, height: 320 }
  );
});

// --- runWithTimeout ----------------------------------------------------------

test('runWithTimeout: fast resolve passes value through', async () => {
  const v = await runWithTimeout(async () => ({ available: true, label: 'ok' }), 1000);
  assert.deepStrictEqual(v, { available: true, label: 'ok' });
});

test('runWithTimeout: slow resolve produces synthetic timeout payload shape', async () => {
  const v = await runWithTimeout(
    () => new Promise((res) => setTimeout(() => res('late'), 200)),
    20
  );
  assert.strictEqual(v.available, false);
  assert.strictEqual(v.source, 'account-usage');
  assert.ok(v.providers && v.providers.codex && v.providers.claude);
  assert.strictEqual(v.providers.codex.available, false);
  assert.strictEqual(v.providers.codex.message, 'Provider timed out');
  assert.strictEqual(v.providers.claude.message, 'Provider timed out');
  assert.ok(v.errors && v.errors.timeout);
});

test('runWithTimeout: thrown error converts to error payload', async () => {
  const v = await runWithTimeout(async () => { throw new Error('boom'); }, 1000);
  assert.strictEqual(v.available, false);
  assert.strictEqual(v.providers.codex.message, 'boom');
  assert.strictEqual(v.providers.claude.message, 'boom');
  assert.ok(v.errors && v.errors.fatal === 'boom');
});

// --- buildTimeoutPayload / buildErrorPayload ---------------------------------

test('buildTimeoutPayload: shape includes both providers + timeout error', () => {
  const p = buildTimeoutPayload(15000);
  assert.strictEqual(p.available, false);
  assert.ok(p.errors.timeout.includes('15000'));
  assert.strictEqual(p.providers.codex.message, 'Provider timed out');
});

test('buildErrorPayload: surfaces error message verbatim', () => {
  const p = buildErrorPayload(new Error('upstream 500'));
  assert.strictEqual(p.errors.fatal, 'upstream 500');
  assert.strictEqual(p.providers.claude.message, 'upstream 500');
});

test('buildErrorPayload: handles non-Error inputs', () => {
  const p = buildErrorPayload('plain string');
  assert.strictEqual(p.errors.fatal, 'plain string');
});

// --- provider rate-limit helpers --------------------------------------------

test('isProviderHttp429: detects provider HTTP 429 messages', () => {
  assert.strictEqual(isProviderHttp429({
    providers: { claude: { available: false, message: 'HTTP 429' } },
    errors: {}
  }, 'claude'), true);
  assert.strictEqual(isProviderHttp429({
    providers: { claude: { available: false, message: 'HTTP 500' } },
    errors: { claude: 'HTTP 429' }
  }, 'claude'), true);
  assert.strictEqual(isProviderHttp429({
    providers: { claude: { available: false, message: 'HTTP 401' } },
    errors: { claude: 'HTTP 401' }
  }, 'claude'), false);
});

test('buildRateLimitedProvider: tells the user when retry will happen', () => {
  const now = Date.parse('2026-05-01T12:00:00Z');
  const until = now + 15 * 60_000;
  assert.deepStrictEqual(buildRateLimitedProvider('claude', until, now), {
    available: false,
    source: 'claude',
    label: 'Claude --',
    message: 'Rate limited; retrying in 15m'
  });
});

test('withProviderCooldown: preserves other providers and marks provider unavailable', () => {
  const now = Date.parse('2026-05-01T12:00:00Z');
  const usage = {
    available: true,
    source: 'account-usage',
    label: 'GPT 27%',
    updatedAt: new Date(now).toISOString(),
    providers: {
      codex: { available: true, source: 'codex-live', label: 'GPT 27%' },
      claude: { available: false, source: 'claude', label: 'Claude --', message: 'HTTP 429' }
    },
    errors: { claude: 'HTTP 429' },
    primary: { label: 'Session', usedPercent: 27 },
    secondary: null,
    planType: 'Pro'
  };
  const cooled = withProviderCooldown(usage, 'claude', now + 10 * 60_000, now);
  assert.strictEqual(cooled.providers.codex, usage.providers.codex);
  assert.strictEqual(cooled.providers.claude.message, 'Rate limited; retrying in 10m');
  assert.strictEqual(cooled.errors.claude, 'HTTP 429 (rate limited until 2026-05-01T12:10:00.000Z)');
  assert.strictEqual(cooled.label, 'GPT 27%');
});

test('isProviderCacheFresh: only accepts cache entries inside ttl', () => {
  const now = Date.parse('2026-05-01T12:00:00Z');
  assert.strictEqual(isProviderCacheFresh(null, 300_000, now), false);
  assert.strictEqual(isProviderCacheFresh({ provider: { available: true } }, 300_000, now), false);
  assert.strictEqual(isProviderCacheFresh({ savedAtMs: now, provider: null }, 300_000, now), false);
  assert.strictEqual(isProviderCacheFresh({ savedAtMs: now - 299_999, provider: { available: true } }, 300_000, now), true);
  assert.strictEqual(isProviderCacheFresh({ savedAtMs: now - 300_000, provider: { available: true } }, 300_000, now), false);
});

test('buildAccountUsagePayload: matches account usage shape from provider results', () => {
  const usage = buildAccountUsagePayload({
    providers: {
      codex: { available: true, source: 'codex-live', label: 'GPT 20%', primary: { label: 'Session' }, planType: 'Pro' },
      claude: buildUnavailableProvider('claude', 'Rate limited; retrying in 15m')
    },
    errors: { claude: 'HTTP 429' },
    updatedAt: '2026-05-01T12:00:00.000Z'
  });
  assert.strictEqual(usage.available, true);
  assert.strictEqual(usage.label, 'GPT 20%');
  assert.strictEqual(usage.primary.label, 'Session');
  assert.strictEqual(usage.planType, 'Pro');
  assert.strictEqual(usage.providers.claude.label, 'Claude --');
});

// --- buildTooltip ------------------------------------------------------------

test('buildTooltip: zero providers detected returns "No providers detected"', () => {
  assert.strictEqual(buildTooltip(null), 'No providers detected');
  assert.strictEqual(buildTooltip({}), 'No providers detected');
  assert.strictEqual(buildTooltip({ providers: {} }), 'No providers detected');
});

test('buildTooltip: only unavailable providers also returns "No providers detected"', () => {
  const usage = {
    providers: {
      codex:  { available: false, label: 'GPT --',    message: 'no creds' },
      claude: { available: false, label: 'Claude --', message: 'no creds' }
    }
  };
  assert.strictEqual(buildTooltip(usage), 'No providers detected');
});

test('buildTooltip: one available provider shows its label', () => {
  const usage = {
    providers: {
      codex:  { available: false, label: 'GPT --' },
      claude: { available: true,  label: 'Claude 42%' }
    }
  };
  assert.strictEqual(buildTooltip(usage), 'Claude 42%');
});

test('buildTooltip: two available providers joined with middot', () => {
  const usage = {
    providers: {
      codex:  { available: true, label: 'GPT 67%' },
      claude: { available: true, label: 'Claude 42%' }
    }
  };
  // Order follows Object.values insertion order.
  assert.strictEqual(buildTooltip(usage), 'GPT 67% · Claude 42%');
});

test('buildTooltip: unavailable providers omitted from join', () => {
  const usage = {
    providers: {
      codex:  { available: true,  label: 'GPT 67%' },
      claude: { available: false, label: 'Claude --' },
      hermes: { available: true,  label: 'Hermes 12%' }
    }
  };
  assert.strictEqual(buildTooltip(usage), 'GPT 67% · Hermes 12%');
});

// --- readJsonSafe / writeJsonAtomic -----------------------------------------

function tmpFile(name) {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pum-test-')),
    name
  );
}

test('readJsonSafe: missing file returns defaults clone', () => {
  const r = readJsonSafe(tmpFile('does-not-exist.json'), { foo: 1 });
  assert.deepStrictEqual(r, { foo: 1 });
});

test('readJsonSafe: missing file with null defaults returns null', () => {
  const r = readJsonSafe(tmpFile('does-not-exist.json'), null);
  assert.strictEqual(r, null);
});

test('writeJsonAtomic + readJsonSafe round-trip', () => {
  const p = tmpFile('round-trip.json');
  writeJsonAtomic(p, { x: 100, y: 200, width: 340, height: 180 });
  const r = readJsonSafe(p, null);
  assert.deepStrictEqual(r, { x: 100, y: 200, width: 340, height: 180 });
});

test('readJsonSafe: malformed JSON returns defaults (no throw)', () => {
  const p = tmpFile('broken.json');
  fs.writeFileSync(p, '{ this is not valid JSON');
  const r = readJsonSafe(p, { ok: true });
  assert.deepStrictEqual(r, { ok: true });
});

test('readJsonSafe: parsed object merged over defaults', () => {
  const p = tmpFile('merge.json');
  writeJsonAtomic(p, { openAtLogin: true });
  const r = readJsonSafe(p, { openAtLogin: false, other: 'kept' });
  assert.deepStrictEqual(r, { openAtLogin: true, other: 'kept' });
});
