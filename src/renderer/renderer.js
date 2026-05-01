'use strict';

document.addEventListener('DOMContentLoaded', () => {
  console.log('[renderer] mounted, api keys =', Object.keys(window.api || {}));
  if (!window.api || typeof window.api.onUsage !== 'function') {
    console.error('[renderer] preload bridge missing');
    return;
  }
  window.api.onUsage((usage) => {
    console.log('[renderer:M2] usage update', usage && usage.label, Object.keys(usage?.providers || {}));
  });

  document.getElementById('refresh').addEventListener('click', async () => {
    const res = await window.api.refreshNow();
    console.log('[renderer:M2] refresh accepted =', res?.accepted);
  });
  document.getElementById('close').addEventListener('click', () => window.api.hide());
});
