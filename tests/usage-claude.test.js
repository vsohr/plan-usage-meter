'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { fetchClaudeUsage } = require('../src/usage');

function writeCredentials() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pum-claude-test-'));
  const credentialsPath = path.join(dir, '.credentials.json');
  fs.writeFileSync(credentialsPath, JSON.stringify({
    claudeAiOauth: {
      accessToken: 'test-token',
      subscriptionType: 'max'
    }
  }));
  return credentialsPath;
}

test('fetchClaudeUsage: treats Claude utilization as percent, not fraction', async (t) => {
  const credentialsPath = writeCredentials();
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });

  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      five_hour: {
        utilization: 1,
        resets_at: '2026-05-03T00:40:00.179Z'
      },
      seven_day: {
        utilization: 51,
        resets_at: '2026-05-06T18:00:00.179Z'
      },
      seven_day_sonnet: {
        utilization: 0,
        resets_at: null
      },
      extra_usage: {
        is_enabled: false,
        utilization: null
      }
    })
  });

  const usage = await fetchClaudeUsage(credentialsPath);

  assert.strictEqual(usage.label, 'Claude 1%');
  assert.strictEqual(usage.primary.usedPercent, 1);
  assert.strictEqual(usage.secondary.usedPercent, 51);
  assert.deepStrictEqual(usage.details[0], {
    label: 'Sonnet weekly',
    usedPercent: 0,
    windowMinutes: null,
    resetsAt: null
  });
});
