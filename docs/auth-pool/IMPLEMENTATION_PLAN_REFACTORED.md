# Claude Authentication Pool - Implementation Plan (Refactored)

**Status:** 📋 High-Level Plan
**Last Updated:** 2026-01-28
**Purpose:** Concise outline for auth pool implementation

---

## Executive Summary

**Objective:** Intelligent authentication pool manager for multiple Claude subscriptions

**Approach:** Extend anthropic-headless-api as middleware layer

**Data Source:** Claude CLI JSON output (primary source of truth)

**Key Innovation:** Real-time usage tracking from existing API responses (no ccusage dependency)

---

## Architecture Overview

```
Request → Auth Pool Middleware → Router → Backend → Claude CLI
                                                          ↓
                                            Response (with cost/tokens)
                                                          ↓
                                      Usage Tracker ← Parse metadata
                                                          ↓
                                      Subscription State Updated
```

**Integration Point:** Middleware layer (before routing decisions)

**Storage:** Cloudflare Durable Objects (production) OR In-memory (development)

---

## Core Modules

### 1. Subscription Manager
- **Purpose:** CRUD operations for subscriptions
- **Responsibilities:** Load config, persist state, health checks
- **Key Data:** Subscription state (cost, budget, clients, health score)

### 2. Usage Tracker
- **Purpose:** Track usage from Claude CLI responses
- **Responsibilities:** Parse JSON output, aggregate weekly totals, determine 5-hour blocks
- **Key Insight:** Extract `total_cost_usd` from every response

### 3. Allocation Balancer
- **Purpose:** Select optimal subscription for requests
- **Responsibilities:** Health scoring, safeguards, periodic rebalancing
- **Safeguards:** Max clients per sub, weekly budget threshold, gradual ramp-up

### 4. Health Calculator
- **Purpose:** Score subscriptions (0-100, higher = healthier)
- **Algorithm:**
  - Start at 100
  - Penalize: weekly usage (50% weight), block usage (30%), client count (5 pts each), burn rate
  - Bonus: +10 if idle

### 5. Session Store
- **Purpose:** Map client sessions → subscriptions
- **Responsibilities:** Session lifecycle, status tracking (active/idle/stale)
- **Rotation Support:** Reassign sessions during rebalancing

### 6. Notification Manager
- **Purpose:** Event notifications (webhooks, Sentry, logs)
- **Events:** Usage thresholds, failovers, rotations, limits reached

---

## Data Flow

### Request Lifecycle

1. **Client Request** → API Gateway
2. **Middleware** → Allocate subscription (if tools required)
3. **Router** → Map subscriptionId → backend
4. **Process Pool** → Execute Claude CLI
5. **CLI Response** → Contains `total_cost_usd`, `usage`, `session_id`
6. **Usage Tracker** → Parse response, update subscription
7. **Return** → Response to client

### Background Jobs

- **Rebalancing:** Every 5 minutes (configurable)
  - Check cost imbalance (threshold: $5 gap)
  - Move idle clients from high-usage to low-usage subscriptions
  - Max 3 clients per cycle

- **Session Cleanup:** Hourly
  - Delete sessions with no activity > 60 minutes

---

## Configuration

### backends.json (Modified)

```json
{
  "backends": [
    {
      "name": "claude-cli-sub1",
      "type": "claude-cli",
      "configDir": "/Users/vmks/.claude-sub1",
      "subscriptionId": "sub1"
    }
  ],
  "authPool": {
    "enabled": true,
    "configPath": "config/auth-pool.yaml"
  }
}
```

### auth-pool.yaml (New)

```yaml
subscriptions:
  - id: sub1
    email: user@example.com
    type: claude-pro
    configDir: /Users/vmks/.claude-sub1
    weeklyBudget: 456.00

safeguards:
  maxClientsPerSubscription: 15
  weeklyBudgetThreshold: 0.85

rebalancing:
  enabled: true
  intervalSeconds: 300
  costGapThreshold: 5.00

notifications:
  webhookUrl: https://your-webhook.com
  rules:
    - type: usage_threshold
      threshold: 0.80
      channels: [webhook, log]
```

---

## Key Decisions & Rationale

### ✅ Why Claude CLI JSON Output (Not ccusage)?

**PRD v2 was wrong:**
- ❌ Used ccusage CLI tool (17-20s latency on first run)
- ❌ Required separate polling
- ❌ External dependency

**Correct approach:**
- ✅ Claude CLI already provides complete usage data in EVERY response
- ✅ Real-time (no polling delay)
- ✅ Already integrated in anthropic-headless-api
- ✅ No external dependencies

### ✅ Why 5-Hour Blocks (Not 24-Hour Days)?

Anthropic's billing operates on 5-hour rolling windows, not daily resets:
- Blocks start at: 00:00, 05:00, 10:00, 15:00, 20:00 UTC
- Usage resets every 5 hours
- Must track block-specific costs separately from weekly totals

### ✅ Why Periodic Rebalancing?

User requirement: "Even if a subscription has not been exhausted, if there are subscriptions with less usage, the system should transition."

**Implementation:**
- Background job runs every 5 minutes
- Checks cost gap between subscriptions
- If gap > $5: move idle clients to balance load
- Max 3 clients moved per cycle (gradual)

### ✅ Why Safeguards?

**Problem:** Overloading a single subscription can trigger rate limits

**Solution:**
- Max 15 clients per subscription
- 85% weekly budget threshold
- Fresh subscriptions: gradual ramp-up (Day 1: 5 clients, Day 2: 10, Day 3+: 15)
- Fallback to API when all subscriptions exceed thresholds

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
**Goal:** Create all specifications and test suites

**Deliverables:**
- ✅ ANTHROPIC_USAGE_API_RESEARCH.md
- ✅ MODULE_ARCHITECTURE.md
- ✅ DATA_MODELS.md
- ✅ PROJECT_STRUCTURE.md
- ✅ PSEUDOCODE.md
- ✅ INTEGRATION_PLAN.md
- ✅ TESTING_STRATEGY.md
- ⏭️ Write all unit tests (TDD - tests first, all failing)

**Success Criteria:** 100% test coverage planned, all specs documented

---

### Phase 2: Core Modules (Week 2)
**Goal:** Implement core functionality (make tests pass)

**Parallel Work (3 developers):**

**Developer 1: Storage & Utilities**
- `types.ts`
- `storage/storage-interface.ts`
- `storage/memory-store.ts`
- `utils/validators.ts`, `time-utils.ts`, `block-calculator.ts`

**Developer 2: Core Business Logic**
- `core/health-calculator.ts`
- `core/subscription-manager.ts`
- `core/usage-tracker.ts`

**Developer 3: Allocation & Sessions**
- `core/session-store.ts`
- `core/allocation-balancer.ts`
- `core/notification-manager.ts`

**Success Criteria:** All unit tests passing

---

### Phase 3: Integration (Week 3)
**Goal:** Connect modules, build middleware, integration tests passing

**Work:**
- `middleware.ts`
- `index.ts` (module exports)
- Modify `src/index.ts`, `src/routes/chat.ts`, `src/lib/router.ts`
- Integration tests

**Success Criteria:** Integration tests passing, API functional

---

### Phase 4: Production Storage (Week 4)
**Goal:** Cloudflare Durable Object implementation

**Work:**
- `storage/durable-object-store.ts`
- Deploy to Cloudflare Workers
- E2E tests with real Claude CLI

**Success Criteria:** E2E tests passing, production-ready

---

### Phase 5: Observability (Week 5)
**Goal:** Monitoring, notifications, hardening

**Work:**
- Webhook integration
- Sentry error tracking
- Performance testing (1000+ concurrent clients)
- Security audit

**Success Criteria:** Production monitoring complete

---

## File Creation Order

**Phase 1 (Foundation):**
1. `types.ts`
2. `storage/storage-interface.ts`
3. `storage/memory-store.ts`
4. `utils/validators.ts`, `time-utils.ts`, `block-calculator.ts`

**Phase 2 (Core):**
5. `core/health-calculator.ts`
6. `core/subscription-manager.ts`
7. `core/usage-tracker.ts`
8. `core/session-store.ts`
9. `core/notification-manager.ts`
10. `core/allocation-balancer.ts`

**Phase 3 (Integration):**
11. `middleware.ts`
12. `index.ts`
13. Modify existing files

**Phase 4 (Production):**
14. `storage/durable-object-store.ts`

---

## Code Statistics

| Category | Files | Lines |
|----------|-------|-------|
| New Code | 14 | ~3,330 |
| Modified Code | 5 | ~95 |
| Tests | 13 | ~1,800 |
| Documentation | 7 | ~2,500 |
| Config | 1 | ~50 |
| **TOTAL** | **40** | **~7,775** |

---

## Risk Mitigation

### Risk 1: Claude CLI Response Changes
**Mitigation:** Validate JSON structure on every parse, fallback to defaults

### Risk 2: Rebalancing Disrupts Active Sessions
**Mitigation:** Only move idle sessions (no activity 5+ minutes)

### Risk 3: Race Conditions in Allocation
**Mitigation:** Atomic updates via Durable Object transactions

### Risk 4: Subscription Authentication Expires
**Mitigation:** Health checks detect expired auth, mark as unavailable

---

## Success Criteria

- [ ] All unit tests passing (90%+ coverage)
- [ ] All integration tests passing
- [ ] All E2E tests passing
- [ ] Usage tracking accurate (matches Claude CLI output)
- [ ] Periodic rebalancing working
- [ ] Safeguards enforced (max clients, budget thresholds)
- [ ] Notifications sent correctly (webhooks, Sentry)
- [ ] Failover to API working
- [ ] Session continuity maintained
- [ ] Performance: allocation < 10ms, 1000 concurrent < 5s
- [ ] Zero breaking changes to existing API

---

## Next Steps

1. ✅ Review this plan with user
2. ⏭️ Begin Phase 1: Write all unit tests (TDD)
3. ⏭️ Phase 2: Implement core modules
4. ⏭️ Phase 3: Integration
5. ⏭️ Phase 4: Production storage
6. ⏭️ Phase 5: Observability

---

**Plan Status:** ✅ Ready for Implementation

**All detailed specifications available in:**
- `ANTHROPIC_USAGE_API_RESEARCH.md` - Data source analysis
- `MODULE_ARCHITECTURE.md` - System design
- `DATA_MODELS.md` - All TypeScript interfaces
- `PROJECT_STRUCTURE.md` - Complete file tree
- `PSEUDOCODE.md` - All implementation logic (~2,800 lines)
- `INTEGRATION_PLAN.md` - Step-by-step integration
- `TESTING_STRATEGY.md` - Test cases & QA scenarios
