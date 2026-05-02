'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

test('package exposes a local portable deploy command', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.strictEqual(
    pkg.scripts['deploy:local'],
    'npm run dist:portable && powershell -ExecutionPolicy Bypass -File scripts/install-portable.ps1'
  );
});

test('portable install script installs, shortcuts, and relaunches the app', () => {
  const script = fs.readFileSync(path.join(root, 'scripts', 'install-portable.ps1'), 'utf8');
  assert.match(script, /Programs\\PlanUsageMeter/);
  assert.match(script, /Copy-Item/);
  assert.match(script, /CreateShortcut/);
  assert.match(script, /Desktop/);
  assert.match(script, /Start-Process/);
  assert.match(script, /Stop-Process/);
  assert.match(script, /Plan Usage Meter/);
  assert.match(script, /Stop-AppProcesses/);
});
