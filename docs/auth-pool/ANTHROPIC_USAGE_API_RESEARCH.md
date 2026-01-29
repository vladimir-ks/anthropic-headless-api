# Anthropic Usage API Research

**Status:** ✅ Complete
**Last Updated:** 2026-01-28
**Objective:** Identify primary data sources for real-time Claude usage tracking (session %, weekly limits, cost)

---

## Executive Summary

**PRIMARY DATA SOURCE:** Claude CLI JSON output (already integrated in anthropic-headless-api)
**SECONDARY DATA SOURCE:** Official Anthropic Admin API endpoints
**TERTIARY (UNOFFICIAL):** Reverse-engineered web API (claude.ai sessionKey)

**DECISION:** Use Claude CLI as primary source. It already provides complete usage data including:
- `total_cost_usd` (session cost)
- Token usage (input, output, cache creation, cache read)
- Model usage breakdown
- Session continuity (`session_id`)

This eliminates need for ccusage CLI tool and web scraping.

---

## Data Source Analysis

### 1. Claude CLI JSON Output (PRIMARY - RECOMMENDED)

**Location:** Already implemented in `/src/lib/claude-cli.ts`

**Access Method:**
```bash
claude -p --output-format json "query"
```

**Data Structure:**
```typescript
interface ClaudeCliJsonOutput {
  result: string;              // AI response
  session_id: string;          // Session continuity
  duration_ms: number;         // Total duration
  duration_api_ms: number;     // API call duration
  num_turns: number;           // Conversation turns
  total_cost_usd: number;      // 🎯 COST TRACKING
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage: Array<{         // Per-model breakdown
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
  uuid: string;
  is_error: boolean;
  subtype?: string;
}
```

**Advantages:**
- ✅ Already integrated in existing codebase
- ✅ Real-time data (no polling delay)
- ✅ Accurate session-level cost tracking
- ✅ No external dependencies (ccusage, web scraping)
- ✅ Works for ALL Claude CLI backends
- ✅ Official Anthropic data (100% reliable)

**Limitations:**
- ❌ No weekly budget visibility (only session-level)
- ❌ No cross-account aggregation (per-config-dir only)
- ⚠️ Requires post-processing to calculate weekly totals

**Usage Pattern:**
```typescript
// EXISTING CODE - already in claude-cli-adapter.ts
const result = await executeClaudeQuery(options);
if (result.metadata) {
  const sessionCost = result.metadata.totalCostUsd;
  const tokens = result.metadata.usage;
  // ✅ Track usage immediately after each request
}
```

---

### 2. Anthropic Official Admin API (SECONDARY)

**Base URL:** `https://api.anthropic.com`

**Authentication:** Admin API Key (requires organization access)

**Endpoints:**

#### 2.1 Messages Usage Report
```
GET /v1/organizations/usage_report/messages
```

**Query Parameters:**
- `start_time` (ISO 8601 timestamp)
- `end_time` (ISO 8601 timestamp)
- `time_bucket` (1m, 1h, 1d)
- `group_by` (model, workspace, api_key, service_tier)

**Response:**
```json
{
  "data": [{
    "time_bucket": "2026-01-28T12:00:00Z",
    "model": "claude-sonnet-4-5",
    "tokens": {
      "uncached_input": 12000,
      "cached_input": 5000,
      "cache_creation": 3000,
      "output": 2000
    },
    "cost_usd": 0.15
  }]
}
```

#### 2.2 Cost Report
```
GET /v1/organizations/cost_report
```

**Provides:**
- Service-level cost breakdowns (API, web search, code execution)
- Grouping by workspace or description
- Historical cost tracking

#### 2.3 Claude Code Analytics
```
GET /v1/organizations/usage_report/claude_code
```

**Provides:**
- Daily aggregated usage for Claude Code users
- Developer productivity metrics
- Custom dashboard data

**Advantages:**
- ✅ Official Anthropic data
- ✅ Organization-wide visibility
- ✅ Historical trend analysis
- ✅ Weekly/monthly aggregation built-in

**Limitations:**
- ❌ Requires Admin API key (org-level permission)
- ❌ 5-minute data latency (not real-time)
- ❌ Only works for API usage, not Claude CLI
- ⚠️ Polling overhead (1 req/min max)

**Use Cases:**
- Cross-account weekly budget tracking
- Historical usage analysis
- Organization-level dashboards

---

### 3. Unofficial Web API (TERTIARY - NOT RECOMMENDED)

**Authentication:** sessionKey cookie from claude.ai browser session

**Method:**
1. Login to claude.ai in browser
2. Open DevTools → Application → Cookies
3. Copy `sessionKey` (starts with `sk-ant-sid01...`)
4. Use sessionKey for API calls

**Known Endpoints (Reverse Engineered):**
```
POST https://claude.ai/api/append_message
GET  https://claude.ai/api/organizations/{org_id}/usage
GET  https://claude.ai/api/account_info
```

**Response (Estimated):**
```json
{
  "usage": {
    "current_session_percentage": 45,
    "weekly_percentage_all_models": 62,
    "weekly_percentage_sonnet_only": 48,
    "reset_time": "2026-01-28T17:00:00Z"
  }
}
```

**Advantages:**
- ✅ Real-time session percentage (what user sees on web)
- ✅ Weekly limit visibility
- ✅ Model-specific percentages

**Disadvantages:**
- ❌ **UNOFFICIAL** - violates Anthropic ToS
- ❌ **FRAGILE** - endpoints can change without notice
- ❌ **SECURITY RISK** - requires storing user session cookies
- ❌ **LIMITED SCOPE** - only works for web accounts, not API keys
- ❌ **UNRELIABLE** - sessionKey expires, requires re-authentication

**Verdict:** ❌ DO NOT USE (legal, security, reliability issues)

---

## Recommended Architecture

### Primary Strategy: Claude CLI JSON Output + Local Aggregation

**Implementation:**

```
┌─────────────────────────────────────────────────────────┐
│  1. Request → Claude CLI (per subscription)             │
│     Returns: session_id, total_cost_usd, tokens         │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  2. Usage Tracker (Auth Pool Module)                    │
│     • Parse CLI JSON output                             │
│     • Aggregate by subscription_id                      │
│     • Track 5-hour block costs                          │
│     • Calculate weekly totals                           │
└────────────────┬────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────┐
│  3. Subscription State (Durable Object)                 │
│     Subscription {                                      │
│       currentBlockCost: float  // From CLI              │
│       weeklyUsed: float        // Aggregated locally    │
│       weeklyBudget: float      // Config (default $456) │
│       lastRequestTime: timestamp                        │
│       sessionId: string        // For continuity        │
│     }                                                   │
└─────────────────────────────────────────────────────────┘
```

**Pseudocode:**

```typescript
// After each Claude CLI request
FUNCTION trackUsageFromCliResponse(response, subscriptionId):
  cost = response.metadata.totalCostUsd
  tokens = response.metadata.usage
  sessionId = response.sessionId
  timestamp = NOW()

  // Get subscription state
  subscription = getSubscription(subscriptionId)

  // Determine current 5-hour block
  blockId = getActiveBlockId(timestamp)  // e.g., "2026-01-28T12:00:00Z"

  IF subscription.currentBlockId != blockId:
    // New block started - reset block cost
    subscription.currentBlockCost = cost
    subscription.currentBlockId = blockId
    subscription.blockStartTime = timestamp
  ELSE:
    // Same block - accumulate cost
    subscription.currentBlockCost += cost
  END IF

  // Weekly tracking (rolling 7 days)
  subscription.weeklyUsed = calculateWeeklyTotal(subscriptionId, timestamp)
  subscription.lastRequestTime = timestamp
  subscription.sessionId = sessionId

  // Update state
  saveSubscription(subscription)

  // Calculate health score
  weeklyPercent = (subscription.weeklyUsed / subscription.weeklyBudget) * 100
  blockPercent = calculateBlockPercentage(subscription.currentBlockCost, timestamp)

  subscription.healthScore = 100 - (weeklyPercent * 0.5) - (blockPercent * 0.3) - ...

  RETURN {
    cost: cost,
    weeklyPercent: weeklyPercent,
    blockPercent: blockPercent,
    healthScore: subscription.healthScore
  }
END FUNCTION

FUNCTION calculateWeeklyTotal(subscriptionId, currentTime):
  sevenDaysAgo = currentTime - (7 * 24 * 60 * 60 * 1000)

  // Query usage records for last 7 days
  records = queryUsageRecords(subscriptionId, sevenDaysAgo, currentTime)

  totalCost = SUM(records.map(r => r.cost))

  RETURN totalCost
END FUNCTION

FUNCTION getActiveBlockId(timestamp):
  // 5-hour blocks start at: 00:00, 05:00, 10:00, 15:00, 20:00 UTC
  hour = timestamp.getUTCHours()
  blockStartHour = floor(hour / 5) * 5

  blockStart = new Date(timestamp)
  blockStart.setUTCHours(blockStartHour, 0, 0, 0)

  RETURN blockStart.toISOString()  // "2026-01-28T15:00:00.000Z"
END FUNCTION
```

**Data Storage (Cloudflare Durable Object):**

```typescript
// Key-value pairs in DO storage
STORAGE = {
  // Subscription state
  "subscription:sub1": {
    id: "sub1",
    email: "user1@example.com",
    configDir: "~/.claude-sub1",
    currentBlockId: "2026-01-28T15:00:00.000Z",
    currentBlockCost: 12.50,
    weeklyUsed: 350.00,
    weeklyBudget: 456.00,
    healthScore: 45.2,
    sessionId: "ses_abc123",
    lastRequestTime: 1738073400000
  },

  // Usage records (for weekly aggregation)
  "usage:sub1:1738070000000": {  // timestamp key
    subscriptionId: "sub1",
    cost: 0.15,
    tokens: { input: 1000, output: 500, ... },
    blockId: "2026-01-28T15:00:00.000Z",
    timestamp: 1738070000000
  }
}
```

**Benefits:**
- ✅ No external dependencies (ccusage, web scraping)
- ✅ Real-time tracking (immediate after each request)
- ✅ Accurate cost data (from official Anthropic source)
- ✅ Works for all Claude CLI backends
- ✅ Simple implementation (build on existing code)

---

## Alternative: Hybrid Approach

**Use Admin API for Organization-Wide Visibility**

If managing MULTIPLE organizations or need cross-account dashboards:

1. **Per-Request:** Track via Claude CLI JSON (primary)
2. **Hourly Sync:** Poll Admin API for organization-wide totals
3. **Reconciliation:** Compare CLI aggregation vs Admin API (detect discrepancies)

**Pseudocode:**

```typescript
// Background job (runs every hour)
FUNCTION syncWithAdminApi():
  FOR EACH organization IN organizations:
    // Fetch last hour's usage from Admin API
    endTime = NOW()
    startTime = endTime - (60 * 60 * 1000)  // 1 hour ago

    response = fetch("/v1/organizations/usage_report/messages", {
      start_time: startTime,
      end_time: endTime,
      time_bucket: "1h",
      group_by: "model"
    })

    // Compare with local aggregation
    localTotal = calculateLocalTotal(organization.id, startTime, endTime)
    adminTotal = SUM(response.data.map(d => d.cost_usd))

    discrepancy = abs(localTotal - adminTotal)

    IF discrepancy > 1.00:  // $1 threshold
      logWarning("Usage discrepancy detected", {
        organization: organization.id,
        local: localTotal,
        admin: adminTotal,
        diff: discrepancy
      })

      // Optionally: Adjust local state to match Admin API
      adjustSubscriptionTotals(organization.id, adminTotal)
    END IF
  END FOR
END FUNCTION
```

**Trade-offs:**
- ✅ Cross-validates local tracking
- ✅ Org-wide visibility
- ❌ Requires Admin API key (permissions)
- ❌ 5-minute data latency
- ❌ Additional API calls (cost, rate limits)

---

## Implementation Decision

**CHOSEN APPROACH:** Claude CLI JSON Output as PRIMARY data source

**Rationale:**
1. **Already implemented** in anthropic-headless-api
2. **Real-time** tracking (no polling delay)
3. **Official data** (100% reliable)
4. **No external dependencies** (ccusage removed from architecture)
5. **Works for ALL backends** (not just API, but CLI too)

**Weekly budget tracking:**
- Aggregate usage records in Durable Object storage
- Query last 7 days on-demand
- Calculate weekly total from stored usage records

**Next Steps:**
1. ✅ Document data source (this file)
2. ⏭️ Design module architecture (MODULE_ARCHITECTURE.md)
3. ⏭️ Define data models (DATA_MODELS.md)
4. ⏭️ Create project structure (PROJECT_STRUCTURE.md)

---

## References

**Official Documentation:**
- [Usage & Cost API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api)
- [Rate Limits](https://platform.claude.com/docs/en/api/rate-limits)
- [Claude Code Analytics API](https://platform.claude.com/docs/en/api/admin/usage_report/retrieve_claude_code)
- [Cost Reporting](https://support.claude.com/en/articles/9534590-cost-and-usage-reporting-in-the-claude-console)

**Unofficial Implementations (Reference Only):**
- [claude-unofficial-api](https://github.com/Explosion-Scratch/claude-unofficial-api) - sessionKey-based auth
- [Claude Usage Tracker Extension](https://chrome-stats.com/d/knemcdpkggnbhpoaaagmjiigenifejfo)

**Research Sources:**
- [Claude Limits Overview](https://claudelog.com/faqs/claude-limit/)
- [Claude Code Limits](https://portkey.ai/blog/claude-code-limits/)
- [Understanding Usage Limits](https://www.geeky-gadgets.com/claude-ai-weekly-usage-limits/)
- [Rate Limit Best Practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices)

---

**Document Status:** ✅ Research Complete - Ready for Architecture Design
