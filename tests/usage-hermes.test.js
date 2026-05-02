'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { fetchLiveUsageFromHermes } = require('../src/usage');

test('fetchLiveUsageFromHermes: parses the last JSON line from async execFile output', async () => {
  let callbackCalled = false;
  let observedCommand = null;
  let observedArgs = null;
  let observedOptions = null;

  const execFileImpl = (command, args, options, callback) => {
    observedCommand = command;
    observedArgs = args;
    observedOptions = options;
    setTimeout(() => {
      callbackCalled = true;
      callback(null, [
        'diagnostic line',
        JSON.stringify({
          available: true,
          source: 'hermes-live',
          label: 'GPT 42%',
          updatedAt: '2026-05-01T12:00:00Z',
          planType: 'Pro',
          primary: { label: 'Session', usedPercent: 42, resetsAt: null },
          secondary: null,
          credits: null
        })
      ].join('\n'));
    }, 5);
  };

  const promise = fetchLiveUsageFromHermes({ execFileImpl, timeoutMs: 1234 });
  assert.strictEqual(callbackCalled, false);

  const usage = await promise;
  assert.strictEqual(observedCommand, 'wsl');
  assert.deepStrictEqual(observedArgs.slice(0, 3), ['-e', 'sh', '-lc']);
  assert.strictEqual(observedOptions.timeout, 1234);
  assert.strictEqual(callbackCalled, true);
  assert.strictEqual(usage.source, 'hermes-live');
  assert.strictEqual(usage.primary.usedPercent, 42);
});

test('fetchLiveUsageFromHermes: rejects unavailable payloads', async () => {
  const execFileImpl = (_command, _args, _options, callback) => {
    setTimeout(() => callback(null, JSON.stringify({ available: false })), 5);
  };

  await assert.rejects(
    fetchLiveUsageFromHermes({ execFileImpl }),
    /Hermes usage unavailable/
  );
});
