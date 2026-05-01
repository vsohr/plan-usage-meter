# Security Review

## Milestone 1 — 2026-05-01

**Verdict: NEEDS FIXES**

### Findings

#### CRITICAL Issues

- (CRITICAL) **Electron dependency version outdated with HIGH/CRITICAL vulnerabilities** — package.json — `electron@^28.0.0` currently locked; `npm audit` reports 18 open HIGH/CRITICAL issues including ASAR integrity bypass (GHSA-vmqv-hx8q-j7mg), IDOR in second-instance IPC (GHSA-3c8v-cfp5-9885), and registry key injection on Windows (GHSA-mwmh-mq4g-g6gr). Recommendation: Upgrade to `electron@^41.4.0` or latest stable immediately. This is a blocker for any shipment.

- (CRITICAL) **electron-builder transitive dependency chain vulnerable** — package.json — `@tootallnate/once` via `electron-builder@^24.13.0` has incorrect control flow scoping (GHSA-vpq2-c234-7xj6). Cascades through `http-proxy-agent` → `builder-util` → `app-builder-lib` → `tar`. Recommendation: Upgrade `electron-builder` to `^26.8.1` or newer; `npm audit fix --force` will resolve.

- (CRITICAL) **tar vulnerability affecting build artifact integrity** — package.json/transitive — `tar@<=7.5.10` has 6 hardlink/symlink path traversal issues (GHSA-34x7-hfp2-rc4v, GHSA-8qq5-rm4j-mr97, GHSA-83g3-92jg-28cx, GHSA-qffp-2rhf-9h96, GHSA-9ppj-qmqm-q256, GHSA-r6q2-hw4h-h46w). If a malicious tarball is extracted during build or plugin install, could overwrite arbitrary files. Recommendation: Update to `tar@>=7.6.0` via `npm audit fix --force`.

#### Security Posture (Baseline Checks)

- ✅ **Electron webPreferences hardened correctly** — src/main.js:50–55 — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` all present as mandated.
- ✅ **CSP meta tag in place** — src/renderer/index.html:5–6 — `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'`. Strict; unsafe-inline in styles only is acceptable for frameless Electron.
- ✅ **Preload strictly minimalist** — src/preload.js:1–7 — Only exports __preloadVersion stub via contextBridge; no Node globals leaked.
- ✅ **No eval/Function in renderer or preload** — src/renderer/renderer.js is stub only; preload has no dynamic code.
- ✅ **No secrets committed** — git diff shows legitimate token-handling code in copied detection module only.
- ✅ **Detection module verbatim** — src/usage/index.js (393 lines) matches c:/claude-portal/lib/codex-usage.js.

### Remediation Order

1. **Immediate (before merge):** Run `npm audit fix --force` to upgrade electron, electron-builder, and tar. This resolves all 3 critical CVEs.
2. **Verify:** Re-run `npm audit --audit-level=moderate` confirms no HIGH/CRITICAL.
3. **Test:** `npm install && npm start` still works.

---

## Milestone 1 — Resolution (2026-05-01)

**Verdict after fixes: PASS**

Team lead bumped versions in package.json:
- `electron`: `^28.0.0` → `^41.0.0` (resolves all 18 listed Electron CVEs)
- `electron-builder`: `^24.13.0` → `^26.0.0` (resolves @tootallnate/once + tar advisories)

Verification:
- `npm install`: clean, 299 packages, no native rebuild (AC1 still satisfied).
- `npm audit --audit-level=high`: **found 0 vulnerabilities**.
- `npm start` smoke (5s window-up test): window stays up, first poll returns `{"available":true,"providers":["codex","claude"],"label":"GPT 20%"}`. No console errors.

No code changes required — all security flags in main.js / preload.js / index.html were already correct.

---

## Final review — pre-QA — 2026-05-01

Verdict: **PASS**

Findings:

**Critical Security Controls Verified:**

- ✅ Electron BrowserWindow hardened: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (main.js:113–115).
- ✅ CSP strict: `default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'` (index.html:5–6). Unsafe-inline styles only, appropriate for frameless Electron.
- ✅ Preload minimalist: Only `window.api` surface (5 methods) exposed via contextBridge (preload.js:12–23). No Node globals leaked.
- ✅ IPC input validation: `WIN_HEIGHT` handler clamps `raw` to [80, 1200] range before use (main.js:259–260). `USAGE_REFRESH` returns status; `WIN_HIDE`, `APP_QUIT` take no args (safe). All channels use frozen constant keys.
- ✅ File I/O safe: All paths use `app.getPath('userData')` (main.js:36, 50); no user input in paths. Atomic writes via tmp+rename pattern (main-lib.js:77–81).
- ✅ Persistence: `readJsonSafe()` handles JSON parse errors gracefully; no throw (main-lib.js:65–75). Settings/window-state read on startup, saved with debounce on resize/move.
- ✅ Error handlers: Unhandled rejection and uncaught exception traps in place (main.js:21–22). All async polls wrapped in try/finally.
- ✅ electron-builder: `signAndEditExecutable: false` (for dev builds); `perMachine: false` (per-user install, no elevation required). No auto-update URL (intentionally out-of-scope v1).
- ✅ No secrets in console or files: `npm audit` clean (0 vulnerabilities). No API tokens logged. Usage detection reads local credentials only; nothing sent to untrusted endpoints.
- ✅ Detection module verified: src/usage/index.js byte-for-byte identical to claude-portal/lib/codex-usage.js (SHA256 match). Read-only by convention.
- ✅ No debug code: No console.log spam, no commented-out blocks, no TODOs/FIXMEs in implementation.

**Test Coverage:** All 47 unit tests pass (node:test suite). Timeout, error handling, persistence, clamp, tooltip, and renderer helpers all covered. Integration smoke: `npm start` spawns window, first poll succeeds.

**No critical issues found.**
