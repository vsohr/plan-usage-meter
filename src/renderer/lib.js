'use strict';

function thresholdClass(usedPercent) {
  if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return '';
  if (usedPercent < 0) return '';
  if (usedPercent >= 95) return 'error';
  if (usedPercent >= 75) return 'warn';
  return '';
}

function clampPercent(usedPercent) {
  if (typeof usedPercent !== 'number' || Number.isNaN(usedPercent)) return 0;
  if (usedPercent < 0) return 0;
  if (usedPercent > 100) return 100;
  return usedPercent;
}

function formatResetIn(isoString, now) {
  const t0 = typeof now === 'number' ? now : Date.now();
  if (!isoString) return '—';
  const t = Date.parse(isoString);
  if (!Number.isFinite(t)) return '—';
  const diffMs = t - t0;
  if (diffMs <= 60_000) return 'resets soon';
  const mins = Math.round(diffMs / 60_000);
  if (mins < 60) return `resets in ${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `resets in ${hours}h ${rem}m`;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { thresholdClass, clampPercent, formatResetIn };
}
