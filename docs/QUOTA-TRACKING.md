---
metadata:
  modules: [anthropic-headless-api, quota-tracking]
  tldr: "Quota tracking using undocumented OAuth API"
  dependencies: [ARCHITECTURE.md]
  code_refs: [src/services/quota-tracker.ts]
---

# Quota Tracking System

## Overview

This document describes how to track Claude Code subscription quotas programmatically using the undocumented OAuth API.

## OAuth Usage API

### Endpoint

```
GET https://api.anthropic.com/api/oauth/usage
```

### Headers

```
Authorization: Bearer <oauth_access_token>
anthropic-beta: oauth-2025-04-20
```

### Response

```json
{
  "five_hour": {
    "utilization": 50.0,
    "resets_at": "2026-01-16T18:59:59.753369+00:00"
  },
  "seven_day": {
    "utilization": 20.0,
    "resets_at": "2026-01-22T17:59:59.753394+00:00"
  },
  "seven_day_oauth_apps": null,
  "seven_day_opus": null,
  "seven_day_sonnet": {
    "utilization": 4.0,
    "resets_at": "2026-01-23T09:59:59.753406+00:00"
  },
  "iguana_necktie": null,
  "extra_usage": {
    "is_enabled": false,
    "monthly_limit": null,
    "used_credits": null,
    "utilization": null
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `five_hour.utilization` | number | Percentage of 5-hour rolling window used |
| `five_hour.resets_at` | ISO8601 | When the 5-hour window resets |
| `seven_day.utilization` | number | Percentage of 7-day rolling window used |
| `seven_day.resets_at` | ISO8601 | When the 7-day window resets |
| `seven_day_sonnet.utilization` | number | Sonnet-specific 7-day usage (if applicable) |
| `seven_day_opus.utilization` | number | Opus-specific 7-day usage (if applicable) |
| `extra_usage.is_enabled` | boolean | Whether extra usage billing is enabled |

## Credential Storage

### macOS Keychain

Claude Code stores OAuth credentials in macOS Keychain:

```
Service: Claude Code-credentials
Account: (varies)
```

**Structure:**
```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "...",
    "expiresAt": "..."
  }
}
```

### Extracting Token

```bash
# macOS
TOKEN=$(security find-generic-password -s "Claude Code-credentials" -w 2>/dev/null | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])")

# Linux (using secret-tool)
TOKEN=$(secret-tool lookup service "Claude Code-credentials" | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['claudeAiOauth']['accessToken'])")
```

## Implementation

### Quota Checker Module

```typescript
// src/lib/quota-checker.ts

interface QuotaInfo {
  fiveHour: WindowInfo | null;
  sevenDay: WindowInfo | null;
  sevenDaySonnet: WindowInfo | null;
  sevenDayOpus: WindowInfo | null;
  extraUsage: ExtraUsageInfo | null;
}

interface WindowInfo {
  utilization: number;  // 0-100
  resetsAt: Date;
}

interface ExtraUsageInfo {
  isEnabled: boolean;
  monthlyLimit: number | null;
  usedCredits: number | null;
  utilization: number | null;
}

async function getQuota(configDir: string): Promise<QuotaInfo> {
  // 1. Extract OAuth token from keychain/config
  const token = await extractOAuthToken(configDir);

  // 2. Call usage API
  const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
    headers: {
      'Authorization': `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
    },
  });

  // 3. Parse and return
  const data = await response.json();
  return parseQuotaResponse(data);
}

async function extractOAuthToken(configDir: string): Promise<string> {
  if (process.platform === 'darwin') {
    // macOS: use security command
    const result = await exec(
      `security find-generic-password -s "Claude Code-credentials" -w`
    );
    const creds = JSON.parse(result.stdout);
    return creds.claudeAiOauth.accessToken;
  }

  // Linux: check ~/.claude/credentials or secret-tool
  // ...
}
```

### Per-Account Quota Storage

Each account has its own credential storage. For multi-account routing:

```yaml
# config/accounts.yaml
accounts:
  - id: "primary"
    name: "Primary Max Account"
    config_dir: "~/.claude"           # Default location
    keychain_service: "Claude Code-credentials"

  - id: "secondary"
    name: "Secondary Pro Account"
    config_dir: "~/.claude-inst-a2"
    keychain_service: "Claude Code-credentials-a2"  # Separate keychain entry
```

### Quota-Aware Routing Algorithm

```typescript
interface AccountWithQuota {
  account: Account;
  quota: QuotaInfo;
}

function selectBestAccount(accounts: AccountWithQuota[]): Account {
  // Filter to enabled, healthy accounts
  const available = accounts.filter(a =>
    a.account.enabled &&
    a.account.health === 'healthy'
  );

  if (available.length === 0) {
    throw new Error('No accounts available');
  }

  // Sort by lowest 7-day utilization (primary metric)
  // Then by lowest 5-hour utilization (secondary)
  available.sort((a, b) => {
    const aUtil7d = a.quota.sevenDay?.utilization ?? 100;
    const bUtil7d = b.quota.sevenDay?.utilization ?? 100;

    if (aUtil7d !== bUtil7d) {
      return aUtil7d - bUtil7d;  // Lower is better
    }

    const aUtil5h = a.quota.fiveHour?.utilization ?? 100;
    const bUtil5h = b.quota.fiveHour?.utilization ?? 100;
    return aUtil5h - bUtil5h;
  });

  return available[0].account;
}
```

### Quota Refresh Strategy

```typescript
interface QuotaCache {
  accountId: string;
  quota: QuotaInfo;
  fetchedAt: Date;
  ttl: number;  // seconds
}

class QuotaCacheManager {
  private cache = new Map<string, QuotaCache>();

  // Refresh quota before routing decisions
  async getQuota(accountId: string): Promise<QuotaInfo> {
    const cached = this.cache.get(accountId);
    const now = new Date();

    // Use cache if fresh (< 60 seconds old)
    if (cached && (now.getTime() - cached.fetchedAt.getTime()) < cached.ttl * 1000) {
      return cached.quota;
    }

    // Fetch fresh quota
    const quota = await fetchQuotaFromAPI(accountId);
    this.cache.set(accountId, {
      accountId,
      quota,
      fetchedAt: now,
      ttl: 60,  // 1 minute cache
    });

    return quota;
  }

  // Background refresh for all accounts
  async refreshAll(): Promise<void> {
    const accounts = await getAllAccounts();
    await Promise.all(
      accounts.map(a => this.getQuota(a.id))
    );
  }
}
```

## Monitoring & Alerts

### Prometheus Metrics

```typescript
// Gauge for current utilization
const quotaUtilization = new Gauge({
  name: 'claude_quota_utilization_percent',
  help: 'Current quota utilization percentage',
  labelNames: ['account_id', 'window'],  // window: 5h, 7d, 7d_sonnet
});

// Update metrics after each quota fetch
function updateMetrics(accountId: string, quota: QuotaInfo) {
  if (quota.fiveHour) {
    quotaUtilization.labels(accountId, '5h').set(quota.fiveHour.utilization);
  }
  if (quota.sevenDay) {
    quotaUtilization.labels(accountId, '7d').set(quota.sevenDay.utilization);
  }
}
```

### Alert Thresholds

```yaml
# config/alerts.yaml
alerts:
  - name: quota_warning
    condition: "utilization > 70"
    window: "7d"
    action: "notify"

  - name: quota_critical
    condition: "utilization > 90"
    window: "7d"
    action: "pause_non_priority"

  - name: quota_exhausted
    condition: "utilization >= 100"
    window: "5h"
    action: "failover_to_next_account"
```

## Scheduling for Quota Optimization

### End-of-Window Processing

Schedule batch jobs to run just before quota reset:

```typescript
function scheduleForEndOfWindow(job: BatchJob, quota: QuotaInfo): Date {
  // Get next reset time
  const resetTime = new Date(quota.sevenDay?.resetsAt ?? quota.fiveHour?.resetsAt);

  // Schedule 1 hour before reset
  const scheduledTime = new Date(resetTime.getTime() - 60 * 60 * 1000);

  // Don't schedule in the past
  if (scheduledTime < new Date()) {
    return new Date();  // Run immediately
  }

  return scheduledTime;
}
```

### Load Balancing Strategy

```
High Priority (immediate):
  → Route to account with MOST available quota
  → Reason: Ensure completion

Low Priority (batched):
  → Route to account with LOWEST utilization
  → Schedule for end-of-window
  → Reason: Maximize total throughput across accounts
```

## Caveats

1. **Undocumented API**: This endpoint is not officially documented and may change
2. **Token Refresh**: OAuth tokens expire; need to handle refresh
3. **Rate Limits**: Don't poll quota API too frequently
4. **Multi-device**: Same account used on multiple devices shares quota

## Sources

- [Codelynx: Claude Code Usage Limits in Statusline](https://codelynx.dev/posts/claude-code-usage-limits-statusline)
- [GitHub Issue #5621: StatusLine should expose API usage](https://github.com/anthropics/claude-code/issues/5621)
