'use strict';
const fs = require('fs');
const path = require('path');

const ASSETS = [
  { p: path.join('assets', 'icon.ico'), minBytes: 1024 },
  { p: path.join('assets', 'tray.png'), minBytes: 64 }
];

let failed = false;
for (const a of ASSETS) {
  try {
    const stat = fs.statSync(a.p);
    if (stat.size < a.minBytes) {
      console.error(`[check-icons] ${a.p} is too small (${stat.size} bytes < ${a.minBytes}). Replace with real artwork before dist.`);
      failed = true;
    }
  } catch (err) {
    console.error(`[check-icons] missing ${a.p}: ${err.message}`);
    failed = true;
  }
}

if (failed) {
  console.error('\n[check-icons] FAIL: required asset(s) missing or undersized.');
  console.error('See docs/team/ARCHITECTURE.md "Tray Icon Generation" for size requirements.');
  console.error('icon.ico must contain a 256x256 layer (electron-builder requirement).');
  process.exit(1);
}
console.log('[check-icons] OK');
