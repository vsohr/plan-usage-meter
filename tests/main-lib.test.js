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
  isClaudeTokenStale,
  refreshClaudeOauthCredentials,
  ensureFreshClaudeCredentials
} = require('../src/main-lib');

const display = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };

// --- CH ----------------------------------------------------------------------

test('CH: channel constants exist and are frozen', () => {
  assert.strictEqual(CH.USAGE_UPDATE, 'usage:update');
  assert.strictEqual(CH.USAGE_REFRESH, 'usage:refresh');
  assert.strictEqual(CH.WIN_HIDE, 'window:hide');
  assert.strictEqual(CH.APP_QUIT, 'app:quit');
  assert.strictEqual(CH.WIN_HEIGHT, 'window:report-height');
  assert.strictEqual(CH.WIN_MODE_SET, 'window:set-mode');
  assert.strictEqual(CH.WIN_MODE, 'window:mode');
  assert.ok(Object.isFrozen(CH));
});

test('usage cadence constants keep providers on a ten-minute window', () => {
  assert.strictEqual(AUTO_POLL_INTERVAL_MS, 10 * 60_000);
  assert.strictEqual(PROVIDER_USAGE_CACHE_MS, 10 * 60_000);
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
  const r = clampToDisplay({ x: 100, y: 100, width: 180, height: 200 }, display);
  assert.deepStrictEqual(r, { x: 100, y: 100, width: 180, height: 200 });
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

test('clampToDisplay: width forced to compact expanded meter width', () => {
  const r = clampToDisplay({ x: 50, y: 50, width: 999, height: 200 }, display);
  assert.strictEqual(r.width, 180);
});

test('clampToDisplay: missing height defaults to compact expanded meter height', () => {
  const r = clampToDisplay({ x: 50, y: 50 }, display);
  assert.strictEqual(r.height, 180);
});

test('clampToDisplay: null display returns null', () => {
  assert.strictEqual(clampToDisplay({ x: 100, y: 100, height: 200 }, null), null);
});

test('clampToDisplay: single-display happy path (bottom-right within work area)', () => {
  const r = clampToDisplay(
    { x: 1724, y: 824, width: 180, height: 200 },
    display
  );
  assert.deepStrictEqual(r, { x: 1724, y: 824, width: 180, height: 200 });
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

test('pinnedResizeBounds: shrinks while keeping the bottom edge pinned', () => {
  assert.deepStrictEqual(
    pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 240),
    { x: 10, y: 80, width: 180, height: 240 }
  );
});

test('pinnedResizeBounds: pins bottom edge for real height changes', () => {
  assert.deepStrictEqual(
    pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 320),
    { x: 10, y: 0, width: 180, height: 320 }
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
  writeJsonAtomic(p, { x: 100, y: 200, width: 180, height: 180 });
  const r = readJsonSafe(p, null);
  assert.deepStrictEqual(r, { x: 100, y: 200, width: 180, height: 180 });
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

// --- Claude OAuth refresh ---------------------------------------------------

const NOW = 1_770_000_000_000;
const FRESH_CREDS = () => ({
  claudeAiOauth: {
    accessToken: 'live-token',
    refreshToken: 'refresh-xyz',
    expiresAt: NOW + 60 * 60_000,
    scopes: ['user:inference'],
    subscriptionType: 'max',
    rateLimitTier: 'tier-1'
  }
});
const STALE_CREDS = () => ({
  claudeAiOauth: {
    accessToken: 'expired-token',
    refreshToken: 'refresh-xyz',
    expiresAt: NOW - 60_000,
    scopes: ['user:inference'],
    subscriptionType: 'max',
    rateLimitTier: 'tier-1'
  }
});

test('isClaudeTokenStale: fresh token returns false', () => {
  assert.strictEqual(isClaudeTokenStale(FRESH_CREDS(), NOW), false);
});

test('isClaudeTokenStale: token within leeway window returns true', () => {
  const c = FRESH_CREDS();
  c.claudeAiOauth.expiresAt = NOW + (CLAUDE_TOKEN_REFRESH_LEEWAY_MS - 1);
  assert.strictEqual(isClaudeTokenStale(c, NOW), true);
});

test('isClaudeTokenStale: expired token returns true', () => {
  assert.strictEqual(isClaudeTokenStale(STALE_CREDS(), NOW), true);
});

test('isClaudeTokenStale: missing refresh token returns false (cannot refresh)', () => {
  const c = STALE_CREDS();
  c.claudeAiOauth.refreshToken = '';
  assert.strictEqual(isClaudeTokenStale(c, NOW), false);
});

test('isClaudeTokenStale: missing oauth block returns false', () => {
  assert.strictEqual(isClaudeTokenStale({}, NOW), false);
  assert.strictEqual(isClaudeTokenStale(null, NOW), false);
});

function mockFetch(responses) {
  const calls = [];
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (!next) throw new Error('mockFetch: no more queued responses');
      if (next instanceof Error) throw next;
      return {
        ok: next.status >= 200 && next.status < 300,
        status: next.status,
        text: async () => next.body || '',
        json: async () => JSON.parse(next.body || '{}')
      };
    }
  };
}

test('refreshClaudeOauthCredentials: posts refresh grant and updates fields', async () => {
  const mock = mockFetch({
    status: 200,
    body: JSON.stringify({ access_token: 'NEW', refresh_token: 'NEW-R', expires_in: 3600 })
  });
  const next = await refreshClaudeOauthCredentials(STALE_CREDS(), { fetchImpl: mock.fetch, nowMs: NOW });
  assert.strictEqual(next.claudeAiOauth.accessToken, 'NEW');
  assert.strictEqual(next.claudeAiOauth.refreshToken, 'NEW-R');
  assert.strictEqual(next.claudeAiOauth.expiresAt, NOW + 3600 * 1000);
  assert.strictEqual(next.claudeAiOauth.subscriptionType, 'max', 'preserves unrelated fields');
  assert.strictEqual(mock.calls.length, 1);
  const { url, init } = mock.calls[0];
  assert.strictEqual(url, 'https://console.anthropic.com/v1/oauth/token');
  assert.strictEqual(init.method, 'POST');
  const body = JSON.parse(init.body);
  assert.strictEqual(body.grant_type, 'refresh_token');
  assert.strictEqual(body.refresh_token, 'refresh-xyz');
  assert.strictEqual(typeof body.client_id, 'string');
  assert.ok(body.client_id.length > 0);
});

test('refreshClaudeOauthCredentials: keeps prior refresh token when server omits it', async () => {
  const mock = mockFetch({
    status: 200,
    body: JSON.stringify({ access_token: 'NEW', expires_in: 3600 })
  });
  const next = await refreshClaudeOauthCredentials(STALE_CREDS(), { fetchImpl: mock.fetch, nowMs: NOW });
  assert.strictEqual(next.claudeAiOauth.refreshToken, 'refresh-xyz');
});

test('refreshClaudeOauthCredentials: throws on non-2xx', async () => {
  const mock = mockFetch({ status: 401, body: '{"error":"invalid_grant"}' });
  await assert.rejects(
    refreshClaudeOauthCredentials(STALE_CREDS(), { fetchImpl: mock.fetch, nowMs: NOW }),
    /HTTP 401/
  );
});

test('refreshClaudeOauthCredentials: throws when refresh token missing', async () => {
  const c = STALE_CREDS();
  c.claudeAiOauth.refreshToken = '';
  await assert.rejects(
    refreshClaudeOauthCredentials(c, { fetchImpl: async () => { throw new Error('should not call'); }, nowMs: NOW }),
    /refresh token not present/
  );
});

test('ensureFreshClaudeCredentials: fresh token is a no-op (no fetch, no write)', async () => {
  const p = tmpFile('creds-fresh.json');
  fs.writeFileSync(p, JSON.stringify(FRESH_CREDS()));
  const original = fs.readFileSync(p, 'utf8');
  const fetchImpl = async () => { throw new Error('should not call'); };
  const result = await ensureFreshClaudeCredentials(p, { fetchImpl, nowMs: NOW });
  assert.strictEqual(result.refreshed, false);
  assert.strictEqual(result.reason, 'fresh');
  assert.strictEqual(fs.readFileSync(p, 'utf8'), original);
});

test('ensureFreshClaudeCredentials: stale token triggers refresh and atomic rewrite', async () => {
  const p = tmpFile('creds-stale.json');
  fs.writeFileSync(p, JSON.stringify(STALE_CREDS()));
  const mock = mockFetch({
    status: 200,
    body: JSON.stringify({ access_token: 'FRESH', refresh_token: 'FRESH-R', expires_in: 3600 })
  });
  const result = await ensureFreshClaudeCredentials(p, { fetchImpl: mock.fetch, nowMs: NOW });
  assert.strictEqual(result.refreshed, true);
  assert.strictEqual(result.expiresAt, NOW + 3600_000);
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(written.claudeAiOauth.accessToken, 'FRESH');
  assert.strictEqual(written.claudeAiOauth.refreshToken, 'FRESH-R');
  assert.strictEqual(written.claudeAiOauth.subscriptionType, 'max');
});

test('ensureFreshClaudeCredentials: failed refresh leaves original file intact', async () => {
  const p = tmpFile('creds-fail.json');
  fs.writeFileSync(p, JSON.stringify(STALE_CREDS()));
  const original = fs.readFileSync(p, 'utf8');
  const mock = mockFetch({ status: 401, body: '{"error":"invalid_grant"}' });
  await assert.rejects(
    ensureFreshClaudeCredentials(p, { fetchImpl: mock.fetch, nowMs: NOW }),
    /HTTP 401/
  );
  assert.strictEqual(fs.readFileSync(p, 'utf8'), original);
});

test('ensureFreshClaudeCredentials: missing credentials file is a no-op', async () => {
  const p = path.join(os.tmpdir(), 'pum-creds-missing-' + Date.now() + '.json');
  const fetchImpl = async () => { throw new Error('should not call'); };
  const result = await ensureFreshClaudeCredentials(p, { fetchImpl, nowMs: NOW });
  assert.strictEqual(result.refreshed, false);
  assert.strictEqual(result.reason, 'no-credentials-file');
});

test('ensureFreshClaudeCredentials: force=true refreshes even when token is fresh', async () => {
  const p = tmpFile('creds-force.json');
  fs.writeFileSync(p, JSON.stringify(FRESH_CREDS()));
  const mock = mockFetch({
    status: 200,
    body: JSON.stringify({ access_token: 'FORCED', expires_in: 3600 })
  });
  const result = await ensureFreshClaudeCredentials(p, { fetchImpl: mock.fetch, nowMs: NOW, force: true });
  assert.strictEqual(result.refreshed, true);
  const written = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(written.claudeAiOauth.accessToken, 'FORCED');
});

// --- Window mode helpers -----------------------------------------------------

test('window mode widths: expanded is 180, minimal is 96', () => {
  assert.strictEqual(WINDOW_WIDTH_EXPANDED, 180);
  assert.strictEqual(WINDOW_WIDTH_MINIMAL, 96);
});

test('normalizeWindowMode: only "minimal" is honored; everything else is "expanded"', () => {
  assert.strictEqual(normalizeWindowMode('minimal'), 'minimal');
  assert.strictEqual(normalizeWindowMode('expanded'), 'expanded');
  assert.strictEqual(normalizeWindowMode('something-else'), 'expanded');
  assert.strictEqual(normalizeWindowMode(undefined), 'expanded');
  assert.strictEqual(normalizeWindowMode(null), 'expanded');
  assert.strictEqual(normalizeWindowMode(42), 'expanded');
});

test('widthForMode: maps modes to canonical widths', () => {
  assert.strictEqual(widthForMode('expanded'), 180);
  assert.strictEqual(widthForMode('minimal'), 96);
  assert.strictEqual(widthForMode('garbage'), 180);
});

test('defaultHeightForMode: provides a placeholder until renderer reports', () => {
  assert.strictEqual(defaultHeightForMode('expanded'), 180);
  assert.strictEqual(defaultHeightForMode('minimal'), 100);
});

test('pinnedResizeBounds: preserves the current width (mode-aware)', () => {
  assert.deepStrictEqual(
    pinnedResizeBounds({ x: 10, y: 20, width: 64, height: 132 }, 150),
    { x: 10, y: 2, width: 64, height: 150 }
  );
});

test('pinnedResizeBounds: missing width falls back to expanded width', () => {
  // Backwards compat: pre-existing tests/state files may lack width.
  assert.deepStrictEqual(
    pinnedResizeBounds({ x: 10, y: 20, height: 300 }, 320),
    { x: 10, y: 0, width: 180, height: 320 }
  );
});

test('modeResizeBounds: anchors bottom-right when switching modes', () => {
  // Window currently expanded at right edge of work area.
  // Switching to minimal should keep the right and bottom edges.
  const cur = { x: 1724, y: 844, width: 180, height: 180 };
  const next = modeResizeBounds(cur, 'minimal');
  assert.strictEqual(next.width, 96);
  assert.strictEqual(next.height, 100);
  assert.strictEqual(next.x + next.width, cur.x + cur.width);
  assert.strictEqual(next.y + next.height, cur.y + cur.height);
});

test('modeResizeBounds: from minimal back to expanded keeps the corner', () => {
  const cur = { x: 1808, y: 924, width: 96, height: 100 };
  const next = modeResizeBounds(cur, 'expanded');
  assert.strictEqual(next.width, 180);
  assert.strictEqual(next.height, 180);
  assert.strictEqual(next.x + next.width, cur.x + cur.width);
  assert.strictEqual(next.y + next.height, cur.y + cur.height);
});

test('modeResizeBounds: null bounds returns null (no-op)', () => {
  assert.strictEqual(modeResizeBounds(null, 'minimal'), null);
});
