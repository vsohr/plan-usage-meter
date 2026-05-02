const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DEFAULT_CODEX_BASE_URL = 'https://chatgpt.com/backend-api/codex';
const DEFAULT_CODEX_HOME = path.join(process.env.USERPROFILE || process.env.HOME || '', '.codex');
const CODEX_HOME = process.env.CODEX_HOME || DEFAULT_CODEX_HOME;
const CODEX_SESSIONS_DIR = path.join(CODEX_HOME, 'sessions');
const CLAUDE_HOME = process.env.CLAUDE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude');
const CLAUDE_CREDENTIALS_PATH = path.join(CLAUDE_HOME, '.credentials.json');
const HERMES_TIMEOUT_MS = 15_000;

function titleCaseSlug(value) {
  const cleaned = String(value || '').trim();
  if (!cleaned) return null;
  return cleaned.replace(/[_-]/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeLiveWindow(window, label) {
  if (!window || typeof window.used_percent !== 'number') return null;
  const seconds = typeof window.limit_window_seconds === 'number' ? window.limit_window_seconds : null;
  return {
    label,
    usedPercent: window.used_percent,
    windowMinutes: seconds ? Math.round(seconds / 60) : null,
    resetsAt: parseDate(window.reset_at)
  };
}

function normalizeLogWindow(limit, label) {
  if (!limit || typeof limit.used_percent !== 'number') return null;
  return {
    label,
    usedPercent: limit.used_percent,
    windowMinutes: typeof limit.window_minutes === 'number' ? limit.window_minutes : null,
    resetsAt: typeof limit.resets_at === 'number' ? new Date(limit.resets_at * 1000).toISOString() : null
  };
}

function buildUsageResponse({ source, planType, primary, secondary, updatedAt, credits = null, tokens = null }) {
  const latest = primary || secondary;
  if (!latest) return null;
  return {
    available: true,
    source,
    label: `GPT ${Math.round(latest.usedPercent)}%`,
    updatedAt: updatedAt || new Date().toISOString(),
    planType: titleCaseSlug(planType) || planType || null,
    primary,
    secondary,
    credits,
    tokens
  };
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function resolveUsageUrl(baseUrl = DEFAULT_CODEX_BASE_URL) {
  let normalized = String(baseUrl || DEFAULT_CODEX_BASE_URL).trim().replace(/\/+$/, '');
  if (normalized.endsWith('/codex')) {
    normalized = normalized.slice(0, -'/codex'.length);
  }
  if (normalized.includes('/backend-api')) {
    return `${normalized}/wham/usage`;
  }
  return `${normalized}/api/codex/usage`;
}

async function fetchJson(url, headers) {
  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

async function fetchLiveUsageFromCodexAuth(authPath = path.join(CODEX_HOME, 'auth.json')) {
  const auth = readJson(authPath);
  const tokens = auth?.tokens;
  const accessToken = typeof tokens?.access_token === 'string' ? tokens.access_token.trim() : '';
  if (!accessToken) throw new Error('Codex access token not found');

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'User-Agent': 'codex-cli'
  };
  if (tokens.account_id) {
    headers['ChatGPT-Account-Id'] = String(tokens.account_id);
  }

  const payload = await fetchJson(resolveUsageUrl(DEFAULT_CODEX_BASE_URL), headers);
  const rateLimit = payload.rate_limit || {};
  const usage = buildUsageResponse({
    source: 'codex-live',
    planType: payload.plan_type,
    primary: normalizeLiveWindow(rateLimit.primary_window, 'Session'),
    secondary: normalizeLiveWindow(rateLimit.secondary_window, 'Weekly'),
    credits: payload.credits || null
  });
  if (!usage) throw new Error('Codex usage response had no windows');
  return usage;
}

function normalizeClaudeWindow(window, label) {
  if (!window || typeof window.utilization !== 'number') return null;
  const usedPercent = window.utilization <= 1 ? window.utilization * 100 : window.utilization;
  return {
    label,
    usedPercent,
    windowMinutes: null,
    resetsAt: parseDate(window.resets_at)
  };
}

async function fetchClaudeUsage(credentialsPath = CLAUDE_CREDENTIALS_PATH) {
  const credentials = readJson(credentialsPath);
  const oauth = credentials?.claudeAiOauth;
  const accessToken = typeof oauth?.accessToken === 'string' ? oauth.accessToken.trim() : '';
  if (!accessToken) throw new Error('Claude Code OAuth token not found');

  const payload = await fetchJson('https://api.anthropic.com/api/oauth/usage', {
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'anthropic-beta': 'oauth-2025-04-20',
    'User-Agent': 'claude-code/2.1.0'
  });

  const primary = normalizeClaudeWindow(payload.five_hour, 'Session');
  const secondary = normalizeClaudeWindow(payload.seven_day, 'Weekly');
  const details = [];
  for (const [key, label] of [
    ['seven_day_opus', 'Opus weekly'],
    ['seven_day_sonnet', 'Sonnet weekly']
  ]) {
    const window = normalizeClaudeWindow(payload[key], label);
    if (window) details.push(window);
  }
  const extra = payload.extra_usage || {};
  if (extra.is_enabled && typeof extra.utilization === 'number') {
    details.push({
      label: 'Extra usage',
      usedPercent: extra.utilization <= 1 ? extra.utilization * 100 : extra.utilization,
      windowMinutes: null,
      resetsAt: null
    });
  }

  const usage = buildUsageResponse({
    source: 'claude-live',
    planType: oauth.subscriptionType || oauth.rateLimitTier || null,
    primary,
    secondary,
    updatedAt: new Date().toISOString(),
    credits: extra.is_enabled ? extra : null
  });
  if (!usage) throw new Error('Claude usage response had no windows');
  usage.details = details;
  usage.label = `Claude ${Math.round(primary?.usedPercent ?? secondary?.usedPercent ?? 0)}%`;
  return usage;
}

function execFileUtf8(command, args, options, execFileImpl = execFile) {
  return new Promise((resolve, reject) => {
    execFileImpl(command, args, options, (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(stdout);
    });
  });
}

async function fetchLiveUsageFromHermes({ execFileImpl = execFile, timeoutMs = HERMES_TIMEOUT_MS } = {}) {
  const script = [
    'set -eu',
    'AGENT_DIR="${HERMES_AGENT_DIR:-$HOME/.hermes/hermes-agent}"',
    'PY="${HERMES_PYTHON:-$AGENT_DIR/venv/bin/python}"',
    'cd "$AGENT_DIR"',
    '"$PY" - <<\'PY\'',
    String.raw`
import json
from agent.account_usage import fetch_account_usage

snap = fetch_account_usage("openai-codex", base_url="https://chatgpt.com/backend-api/codex")
if not snap:
    raise SystemExit(3)

def dt(value):
    return value.isoformat().replace("+00:00", "Z") if value else None

windows = list(snap.windows or ())
payload = {
    "available": True,
    "source": "hermes-live",
    "label": "GPT --",
    "updatedAt": snap.fetched_at.isoformat().replace("+00:00", "Z"),
    "planType": snap.plan,
    "primary": None,
    "secondary": None,
    "credits": None,
}
if len(windows) > 0:
    payload["primary"] = {
        "label": windows[0].label,
        "usedPercent": windows[0].used_percent,
        "windowMinutes": None,
        "resetsAt": dt(windows[0].reset_at),
    }
    payload["label"] = f"GPT {round(float(windows[0].used_percent or 0))}%"
if len(windows) > 1:
    payload["secondary"] = {
        "label": windows[1].label,
        "usedPercent": windows[1].used_percent,
        "windowMinutes": None,
        "resetsAt": dt(windows[1].reset_at),
    }
for detail in snap.details or ():
    if isinstance(detail, str) and "Credits balance:" in detail:
        payload["credits"] = detail
print(json.dumps(payload))
PY
`
  ].join('\n');

  const output = await execFileUtf8('wsl', ['-e', 'sh', '-lc', script], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore']
  }, execFileImpl);
  const usage = JSON.parse(output.trim().split(/\r?\n/).pop());
  if (!usage?.available) throw new Error('Hermes usage unavailable');
  return usage;
}

function collectCodexSessionFiles(dir, files = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectCodexSessionFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      try {
        const stat = fs.statSync(fullPath);
        files.push({ path: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // Ignore files that disappear while scanning.
      }
    }
  }
  return files;
}

function readCodexUsageFromLogs() {
  const files = collectCodexSessionFiles(CODEX_SESSIONS_DIR)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 100);

  let latestUsage = null;
  let latestTimestampMs = 0;

  for (const file of files) {
    let content;
    try {
      content = fs.readFileSync(file.path, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || !line.includes('"token_count"')) continue;

      try {
        const event = JSON.parse(line);
        const payload = event.payload || {};
        if (event.type !== 'event_msg' || payload.type !== 'token_count') continue;

        const primary = normalizeLogWindow(payload.rate_limits?.primary, 'Session');
        const secondary = normalizeLogWindow(payload.rate_limits?.secondary, 'Weekly');
        const usage = buildUsageResponse({
          source: 'codex-logs',
          planType: payload.plan_type,
          primary,
          secondary,
          updatedAt: event.timestamp || new Date(file.mtimeMs).toISOString(),
          credits: payload.credits || null,
          tokens: payload.info?.total_token_usage || null
        });
        if (!usage) continue;

        const timestampMs = Date.parse(usage.updatedAt) || file.mtimeMs;
        if (!latestUsage || timestampMs > latestTimestampMs) {
          latestUsage = usage;
          latestTimestampMs = timestampMs;
        }
      } catch {
        // Keep scanning older lines/files if a log line is partial.
      }
    }
  }

  if (latestUsage) return latestUsage;
  return {
    available: false,
    source: 'codex-logs',
    label: 'GPT --',
    message: 'No Codex usage source is available yet.'
  };
}

async function getCodexUsage() {
  const errors = [];

  try {
    return await fetchLiveUsageFromHermes();
  } catch (err) {
    errors.push(`hermes-live: ${err.message}`);
  }

  try {
    return await fetchLiveUsageFromCodexAuth();
  } catch (err) {
    errors.push(`codex-live: ${err.message}`);
  }

  const fallback = readCodexUsageFromLogs();
  if (!fallback.available) {
    fallback.errors = errors;
  }
  return fallback;
}

async function getAccountUsage() {
  const providers = {};
  const errors = {};

  try {
    providers.codex = await getCodexUsage();
  } catch (err) {
    errors.codex = err.message;
    providers.codex = {
      available: false,
      source: 'codex',
      label: 'GPT --',
      message: err.message || 'Codex usage unavailable'
    };
  }

  try {
    providers.claude = await fetchClaudeUsage();
  } catch (err) {
    errors.claude = err.message;
    providers.claude = {
      available: false,
      source: 'claude',
      label: 'Claude --',
      message: err.message || 'Claude usage unavailable'
    };
  }

  const preferred = providers.codex?.available ? providers.codex : providers.claude;
  return {
    available: Boolean(providers.codex?.available || providers.claude?.available),
    source: 'account-usage',
    label: preferred?.label || 'AI --',
    updatedAt: new Date().toISOString(),
    providers,
    errors,
    primary: preferred?.primary || null,
    secondary: preferred?.secondary || null,
    planType: preferred?.planType || null
  };
}

module.exports = {
  getAccountUsage,
  getCodexUsage,
  fetchClaudeUsage,
  readCodexUsageFromLogs,
  fetchLiveUsageFromCodexAuth,
  fetchLiveUsageFromHermes
};
