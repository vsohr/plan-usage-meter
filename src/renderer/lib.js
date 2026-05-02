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
  // Day-grain polish: for resets >= 24h away, show "in 5d" or "in 5d 3h"
  // instead of hour-counts that scroll past readability ("118h 22m").
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours === 0
      ? `resets in ${days}d`
      : `resets in ${days}d ${remHours}h`;
  }
  const rem = mins % 60;
  return `resets in ${hours}h ${rem}m`;
}

function providerIconMeta(providerName) {
  if (providerName === 'claude') {
    return { symbolId: 'brand-claude', className: 'provider-icon icon-claude' };
  }
  if (providerName === 'codex') {
    return { symbolId: 'brand-codex', className: 'provider-icon icon-codex' };
  }
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { thresholdClass, clampPercent, formatResetIn, providerIconMeta };
}
