'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { thresholdClass, clampPercent, formatResetIn } = require('../src/renderer/lib');

const NOW = Date.parse('2026-05-01T12:00:00Z');
const EM_DASH = '—';

// --- thresholdClass ----------------------------------------------------------

test('thresholdClass: <75 returns ok (empty)', () => {
  assert.strictEqual(thresholdClass(0), '');
  assert.strictEqual(thresholdClass(50), '');
  assert.strictEqual(thresholdClass(74.9), '');
});

test('thresholdClass: 75..95 returns warn', () => {
  assert.strictEqual(thresholdClass(75), 'warn');
  assert.strictEqual(thresholdClass(85), 'warn');
  assert.strictEqual(thresholdClass(94.9), 'warn');
});

test('thresholdClass: >=95 returns error (crit)', () => {
  assert.strictEqual(thresholdClass(95), 'error');
  assert.strictEqual(thresholdClass(100), 'error');
  assert.strictEqual(thresholdClass(150), 'error');
});

test('thresholdClass: NaN/null/undefined falls back to ok', () => {
  assert.strictEqual(thresholdClass(NaN), '');
  assert.strictEqual(thresholdClass(null), '');
  assert.strictEqual(thresholdClass(undefined), '');
});

test('thresholdClass: non-number / negative falls back to ok', () => {
  assert.strictEqual(thresholdClass(-5), '');
  assert.strictEqual(thresholdClass('80'), '');
});

// --- clampPercent ------------------------------------------------------------

test('clampPercent: in-range pass-through', () => {
  assert.strictEqual(clampPercent(0), 0);
  assert.strictEqual(clampPercent(42.5), 42.5);
  assert.strictEqual(clampPercent(100), 100);
});

test('clampPercent: out-of-range and invalid clamp to 0/100', () => {
  assert.strictEqual(clampPercent(-1), 0);
  assert.strictEqual(clampPercent(150), 100);
  assert.strictEqual(clampPercent(NaN), 0);
  assert.strictEqual(clampPercent(null), 0);
  assert.strictEqual(clampPercent(undefined), 0);
});

// --- formatResetIn -----------------------------------------------------------

test('formatResetIn: null/undefined/empty returns em-dash', () => {
  assert.strictEqual(formatResetIn(null, NOW), EM_DASH);
  assert.strictEqual(formatResetIn(undefined, NOW), EM_DASH);
  assert.strictEqual(formatResetIn('', NOW), EM_DASH);
});

test('formatResetIn: invalid date string returns em-dash', () => {
  assert.strictEqual(formatResetIn('not-a-date', NOW), EM_DASH);
  assert.strictEqual(formatResetIn('2026-13-99', NOW), EM_DASH);
});

test('formatResetIn: past timestamp returns "resets soon" (clock skew)', () => {
  const past = new Date(NOW - 5 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(past, NOW), 'resets soon');
});

test('formatResetIn: <=60s in the future returns "resets soon"', () => {
  const tenSec = new Date(NOW + 10_000).toISOString();
  assert.strictEqual(formatResetIn(tenSec, NOW), 'resets soon');
});

test('formatResetIn: <60min returns minutes-only', () => {
  const t30 = new Date(NOW + 30 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t30, NOW), 'resets in 30m');
});

test('formatResetIn: 1h..24h returns h+m', () => {
  const t = new Date(NOW + (3 * 60 + 12) * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 3h 12m');
});

test('formatResetIn: exact-hour rolls over cleanly', () => {
  const t = new Date(NOW + 60 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 1h 0m');
});

test('formatResetIn: >=24h uses day-grain', () => {
  const fiveDays = new Date(NOW + 5 * 24 * 60 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(fiveDays, NOW), 'resets in 5d');
});

test('formatResetIn: >=24h with leftover hours shows d+h', () => {
  const fiveDaysThreeHours = new Date(NOW + (5 * 24 + 3) * 60 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(fiveDaysThreeHours, NOW), 'resets in 5d 3h');
});

test('formatResetIn: just past 24h boundary uses days', () => {
  const t = new Date(NOW + 25 * 60 * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 1d 1h');
});

test('formatResetIn: just under 24h still uses h+m', () => {
  const t = new Date(NOW + (23 * 60 + 30) * 60_000).toISOString();
  assert.strictEqual(formatResetIn(t, NOW), 'resets in 23h 30m');
});
