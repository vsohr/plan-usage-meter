'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function readAsset(name) {
  return fs.readFileSync(path.join(root, 'assets', name));
}

function pngSize(buf) {
  assert.strictEqual(buf.toString('ascii', 1, 4), 'PNG');
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20)
  };
}

function icoEntries(buf) {
  assert.strictEqual(buf.readUInt16LE(0), 0);
  assert.strictEqual(buf.readUInt16LE(2), 1);
  const count = buf.readUInt16LE(4);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    const offset = 6 + (i * 16);
    entries.push({
      width: buf[offset] || 256,
      height: buf[offset + 1] || 256,
      bytes: buf.readUInt32LE(offset + 8)
    });
  }
  return entries;
}

test('app icon source is a high-resolution generated PNG', () => {
  const source = readAsset('app-icon.png');
  const size = pngSize(source);
  assert.strictEqual(size.width, size.height);
  assert.ok(size.width >= 1024);
  assert.ok(source.length > 100_000);
});

test('runtime and installer icons are derived from the generated artwork', () => {
  const tray = readAsset('tray.png');
  assert.deepStrictEqual(pngSize(tray), { width: 32, height: 32 });
  assert.ok(tray.length > 256);

  const ico = readAsset('icon.ico');
  assert.ok(ico.length > 1024);
  assert.ok(
    icoEntries(ico).some((entry) => entry.width === 256 && entry.height === 256 && entry.bytes > 1024),
    'icon.ico should contain a non-empty 256x256 Windows icon layer'
  );
});
