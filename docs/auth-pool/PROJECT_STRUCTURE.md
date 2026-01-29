# Auth Pool Project Structure

**Status:** 📂 Directory Design
**Last Updated:** 2026-01-28
**Purpose:** Complete file tree and module organization

---

## Directory Tree

```
anthropic-headless-api/
├── src/
│   ├── index.ts                          [MODIFY] Add auth-pool middleware
│   ├── routes/
│   │   └── chat.ts                       [MODIFY] Inject accountContext
│   ├── lib/
│   │   ├── router.ts                     [MODIFY] Accept accountContext param
│   │   ├── backend-registry.ts           [MODIFY] Add subscriptionId field
│   │   ├── claude-cli.ts                 [EXISTING] Usage data source
│   │   └── auth-pool/                    [NEW MODULE]
│   │       ├── index.ts                  [NEW] Module exports
│   │       ├── middleware.ts             [NEW] Express/Hono middleware
│   │       │
│   │       ├── core/                     [Core business logic]
│   │       │   ├── subscription-manager.ts
│   │       │   ├── usage-tracker.ts
│   │       │   ├── allocation-balancer.ts
│   │       │   ├── health-calculator.ts
│   │       │   ├── session-store.ts
│   │       │   └── notification-manager.ts
│   │       │
│   │       ├── storage/                  [Data persistence]
│   │       │   ├── durable-object-store.ts
│   │       │   ├── memory-store.ts
│   │       │   └── storage-interface.ts
│   │       │
│   │       ├── utils/                    [Helpers]
│   │       │   ├── block-calculator.ts
│   │       │   ├── time-utils.ts
│   │       │   └── validators.ts
│   │       │
│   │       └── types.ts                  [TypeScript interfaces]
│   │
│   └── types/
│       └── claude.ts                     [EXTEND] Add auth-pool types
│
├── config/
│   ├── backends.json                     [MODIFY] Add subscriptionId + authPool
│   └── auth-pool.yaml                    [NEW] Auth pool configuration
│
├── docs/
│   └── auth-pool/                        [Documentation]
│       ├── ANTHROPIC_USAGE_API_RESEARCH.md  [✅ Complete]
│       ├── MODULE_ARCHITECTURE.md           [✅ Complete]
│       ├── DATA_MODELS.md                   [✅ Complete]
│       ├── PROJECT_STRUCTURE.md             [📝 This file]
│       ├── PSEUDOCODE.md                    [⏭️ Next]
│       ├── INTEGRATION_PLAN.md              [⏭️ Next]
│       └── TESTING_STRATEGY.md              [⏭️ Next]
│
├── tests/
│   └── auth-pool/                        [Test suite]
│       ├── unit/
│       │   ├── health-calculator.test.ts
│       │   ├── usage-tracker.test.ts
│       │   ├── allocation-balancer.test.ts
│       │   ├── session-store.test.ts
│       │   └── block-calculator.test.ts
│       ├── integration/
│       │   ├── subscription-lifecycle.test.ts
│       │   ├── allocation-flow.test.ts
│       │   ├── rebalancing.test.ts
│       │   └── storage.test.ts
│       └── e2e/
│           ├── full-flow.test.ts
│           ├── failover.test.ts
│           └── rotation.test.ts
│
└── scripts/
    └── auth-pool/                        [Utilities]
        ├── setup-subscriptions.sh
        ├── test-allocation.sh
        └── monitor-usage.sh
```

---

## File Descriptions

### Core Module Files

#### `src/lib/auth-pool/index.ts`
**Purpose:** Public API exports

**Exports:**
```typescript
// Main middleware
export { AuthPoolMiddleware } from './middleware';

// Core managers
export { SubscriptionManager } from './core/subscription-manager';
export { UsageTracker } from './core/usage-tracker';
export { AllocationBalancer } from './core/allocation-balancer';
export { HealthCalculator } from './core/health-calculator';
export { SessionStore } from './core/session-store';
export { NotificationManager } from './core/notification-manager';

// Storage
export { DurableObjectStore } from './storage/durable-object-store';
export { MemoryStore } from './storage/memory-store';
export type { StorageInterface } from './storage/storage-interface';

// Types
export * from './types';
```

**Size Estimate:** ~50 lines

---

#### `src/lib/auth-pool/middleware.ts`
**Purpose:** Express/Hono middleware for auth pool integration

**Responsibilities:**
- Intercept requests before routing
- Allocate subscriptions for tool-requiring requests
- Report usage after completion
- Handle errors gracefully

**Public API:**
```typescript
CLASS AuthPoolMiddleware:
  CONSTRUCTOR(config: PoolConfig)

  // Middleware function
  FUNCTION handle(req, res, next):
    IF requiresTools(req.body):
      accountContext = allocateAccount(req.body.session_id)
      req.accountContext = accountContext
    END IF
    next()
  END FUNCTION

  // Allocation
  FUNCTION allocateAccount(sessionId?: string): Promise<AllocationResult>

  // Usage reporting
  FUNCTION reportUsage(data: UsageReportRequest): Promise<void>

  // Cleanup
  FUNCTION shutdown(): Promise<void>
END CLASS
```

**Size Estimate:** ~150 lines

---

### Core Business Logic

#### `src/lib/auth-pool/core/subscription-manager.ts`
**Purpose:** Subscription CRUD and lifecycle management

**Responsibilities:**
- Load subscriptions from config
- Persist subscription state
- Update subscription metrics
- Validate subscription health

**Key Functions:**
```typescript
CLASS SubscriptionManager:
  CONSTRUCTOR(storage: StorageInterface, config: PoolConfig)

  FUNCTION initialize(): Promise<void>
  FUNCTION getSubscription(id: string): Promise<Subscription | null>
  FUNCTION getAllSubscriptions(): Promise<Subscription[]>
  FUNCTION updateSubscription(id: string, updates: Partial<Subscription>): Promise<void>
  FUNCTION createSubscription(config: SubscriptionConfig): Promise<Subscription>
  FUNCTION deleteSubscription(id: string): Promise<void>
  FUNCTION healthCheck(): Promise<Map<string, boolean>>
END CLASS
```

**Dependencies:**
- StorageInterface (for persistence)
- PoolConfig (configuration)

**Size Estimate:** ~300 lines

---

#### `src/lib/auth-pool/core/usage-tracker.ts`
**Purpose:** Track usage from Claude CLI JSON output

**Responsibilities:**
- Parse ClaudeCliJsonOutput
- Determine active 5-hour block
- Aggregate weekly totals
- Create usage records

**Key Functions:**
```typescript
CLASS UsageTracker:
  CONSTRUCTOR(storage: StorageInterface)

  FUNCTION recordUsage(
    response: ClaudeCliJsonOutput,
    subscriptionId: string
  ): Promise<UsageRecord>

  FUNCTION getWeeklyUsage(subscriptionId: string): Promise<number>

  FUNCTION getActiveBlock(subscriptionId: string): Promise<BlockInfo | null>

  FUNCTION getActiveBlockId(timestamp: number): string

  FUNCTION calculateBurnRate(subscriptionId: string): Promise<number>
END CLASS
```

**Dependencies:**
- StorageInterface (usage records)
- BlockCalculator (block ID generation)

**Size Estimate:** ~250 lines

---

#### `src/lib/auth-pool/core/allocation-balancer.ts`
**Purpose:** Allocation decisions and periodic rebalancing

**Responsibilities:**
- Select optimal subscription for requests
- Rebalance clients across subscriptions
- Enforce safeguards
- Trigger rotation

**Key Functions:**
```typescript
CLASS AllocationBalancer:
  CONSTRUCTOR(
    subscriptionManager: SubscriptionManager,
    healthCalculator: HealthCalculator,
    sessionStore: SessionStore,
    config: PoolConfig
  )

  FUNCTION allocateSubscription(request: AllocationRequest): Promise<AllocationResult>

  FUNCTION releaseAllocation(sessionId: string): Promise<void>

  FUNCTION rebalanceAllocations(): Promise<RebalanceReport>

  FUNCTION checkRotationNeeded(sessionId: string): Promise<boolean>

  FUNCTION startBackgroundRebalancing(intervalMs: number): void

  FUNCTION stopBackgroundRebalancing(): void
END CLASS
```

**Dependencies:**
- SubscriptionManager
- HealthCalculator
- SessionStore
- NotificationManager

**Size Estimate:** ~400 lines

---

#### `src/lib/auth-pool/core/health-calculator.ts`
**Purpose:** Calculate subscription health scores

**Responsibilities:**
- Evaluate subscription state
- Apply scoring algorithm
- Provide score breakdown

**Key Functions:**
```typescript
CLASS HealthCalculator:
  CONSTRUCTOR(config: PoolConfig)

  FUNCTION calculate(subscription: Subscription): number

  FUNCTION explainScore(subscription: Subscription): HealthScoreBreakdown

  PRIVATE FUNCTION calculateWeeklyPenalty(sub: Subscription): number
  PRIVATE FUNCTION calculateBlockPenalty(sub: Subscription): number
  PRIVATE FUNCTION calculateClientPenalty(sub: Subscription): number
  PRIVATE FUNCTION calculateBurnRatePenalty(sub: Subscription): number
  PRIVATE FUNCTION calculateIdleBonus(sub: Subscription): number
END CLASS
```

**Dependencies:** None (pure calculation)

**Size Estimate:** ~200 lines

---

#### `src/lib/auth-pool/core/session-store.ts`
**Purpose:** Session → subscription mapping

**Responsibilities:**
- Track active sessions
- Maintain session metadata
- Handle expiration
- Support rotation

**Key Functions:**
```typescript
CLASS SessionStore:
  CONSTRUCTOR(storage: StorageInterface)

  FUNCTION createSession(sessionId: string, subscriptionId: string): Promise<ClientSession>

  FUNCTION getSession(sessionId: string): Promise<ClientSession | null>

  FUNCTION updateSession(sessionId: string, updates: Partial<ClientSession>): Promise<void>

  FUNCTION deleteSession(sessionId: string): Promise<void>

  FUNCTION getSessionsBySubscription(subscriptionId: string): Promise<ClientSession[]>

  FUNCTION getActiveSessionCount(subscriptionId: string): Promise<number>

  FUNCTION expireStaleSessions(maxAgeMs: number): Promise<number>
END CLASS
```

**Dependencies:**
- StorageInterface

**Size Estimate:** ~250 lines

---

#### `src/lib/auth-pool/core/notification-manager.ts`
**Purpose:** Event notifications and alerts

**Responsibilities:**
- Send webhook notifications
- Log events
- Sentry integration
- Threshold monitoring

**Key Functions:**
```typescript
CLASS NotificationManager:
  CONSTRUCTOR(config: PoolConfig)

  FUNCTION notifyRotation(event: RotationEvent): Promise<void>

  FUNCTION notifyFailover(event: FailoverEvent): Promise<void>

  FUNCTION notifyThreshold(event: ThresholdEvent): Promise<void>

  FUNCTION checkAndNotify(subscription: Subscription): Promise<void>

  PRIVATE FUNCTION send(notification: NotificationEvent, channels: string[]): Promise<void>

  PRIVATE FUNCTION estimateExhaustion(subscription: Subscription): string
END CLASS
```

**Dependencies:**
- External services (webhook URL, Sentry)

**Size Estimate:** ~300 lines

---

### Storage Layer

#### `src/lib/auth-pool/storage/storage-interface.ts`
**Purpose:** Abstract storage interface

**Interface:**
```typescript
INTERFACE StorageInterface:
  // Key-value operations
  FUNCTION get<T>(key: string): Promise<T | null>
  FUNCTION set<T>(key: string, value: T): Promise<void>
  FUNCTION delete(key: string): Promise<void>
  FUNCTION list(prefix: string): Promise<string[]>

  // Batch operations
  FUNCTION getBatch<T>(keys: string[]): Promise<Map<string, T>>
  FUNCTION setBatch<T>(entries: Map<string, T>): Promise<void>

  // Indexes
  FUNCTION addToIndex(indexKey: string, value: string): Promise<void>
  FUNCTION removeFromIndex(indexKey: string, value: string): Promise<void>
  FUNCTION getIndex(indexKey: string): Promise<string[]>

  // Cleanup
  FUNCTION close(): Promise<void>
END INTERFACE
```

**Size Estimate:** ~100 lines

---

#### `src/lib/auth-pool/storage/durable-object-store.ts`
**Purpose:** Cloudflare Durable Object implementation

**Implementation:**
```typescript
CLASS DurableObjectStore IMPLEMENTS StorageInterface:
  CONSTRUCTOR(state: DurableObjectState)

  FUNCTION get<T>(key: string): Promise<T | null>
  FUNCTION set<T>(key: string, value: T): Promise<void>
  FUNCTION delete(key: string): Promise<void>
  FUNCTION list(prefix: string): Promise<string[]>
  // ... (implement all interface methods)
END CLASS
```

**Size Estimate:** ~200 lines

---

#### `src/lib/auth-pool/storage/memory-store.ts`
**Purpose:** In-memory implementation (development/testing)

**Implementation:**
```typescript
CLASS MemoryStore IMPLEMENTS StorageInterface:
  PRIVATE data: Map<string, any>
  PRIVATE indexes: Map<string, Set<string>>

  CONSTRUCTOR()

  FUNCTION get<T>(key: string): Promise<T | null>
  FUNCTION set<T>(key: string, value: T): Promise<void>
  // ... (implement all interface methods)
END CLASS
```

**Size Estimate:** ~150 lines

---

### Utilities

#### `src/lib/auth-pool/utils/block-calculator.ts`
**Purpose:** 5-hour block calculations

**Functions:**
```typescript
FUNCTION getActiveBlockId(timestamp: number): string
FUNCTION getBlockStartTime(timestamp: number): number
FUNCTION getBlockEndTime(timestamp: number): number
FUNCTION isBlockActive(blockId: string): boolean
FUNCTION getBlockProgress(blockId: string): number  // 0-1
```

**Size Estimate:** ~100 lines

---

#### `src/lib/auth-pool/utils/time-utils.ts`
**Purpose:** Time and date utilities

**Functions:**
```typescript
FUNCTION getWeekAgoTimestamp(): number
FUNCTION formatDuration(ms: number): string  // "2h 15m"
FUNCTION formatTimeRemaining(hoursRemaining: number): string
FUNCTION isWithinWindow(timestamp: number, windowMs: number): boolean
```

**Size Estimate:** ~80 lines

---

#### `src/lib/auth-pool/utils/validators.ts`
**Purpose:** Data validation using Zod

**Schemas:**
```typescript
import { z } from 'zod';

export const SubscriptionSchema = z.object({...});
export const AllocationRequestSchema = z.object({...});
export const UsageReportRequestSchema = z.object({...});
// ... (all validation schemas from DATA_MODELS.md)

FUNCTION validateSubscription(data: unknown): Subscription
FUNCTION validateAllocationRequest(data: unknown): AllocationRequest
```

**Size Estimate:** ~250 lines

---

### Types

#### `src/lib/auth-pool/types.ts`
**Purpose:** All TypeScript interfaces (from DATA_MODELS.md)

**Contents:**
- Subscription, ClientSession, UsageRecord, BlockInfo
- AllocationRequest, AllocationResult, UsageReportRequest
- NotificationEvent, RebalanceReport
- PoolConfig, SubscriptionConfig, NotificationRule
- HealthScoreBreakdown

**Size Estimate:** ~400 lines (see DATA_MODELS.md)

---

## Modified Files

### `src/index.ts`

**Changes:**
```typescript
import { AuthPoolMiddleware } from './lib/auth-pool';

// Initialize auth pool
const authPool = new AuthPoolMiddleware(poolConfig);

// Use as middleware
app.use(authPool.handle);

// Shutdown on exit
process.on('SIGTERM', async () => {
  await authPool.shutdown();
});
```

**Lines Changed:** ~20 lines

---

### `src/routes/chat.ts`

**Changes:**
```typescript
// After request parsing
IF requiresTools(body) OR body.backend?.startsWith('claude-cli'):
  accountContext = await req.accountContext;  // Set by middleware
END IF

// Pass to router
decision = await router.route(body, { accountContext });

// Report usage after completion
IF accountContext AND response.claude_metadata:
  await authPool.reportUsage({...});
END IF
```

**Lines Changed:** ~30 lines

---

### `src/lib/router.ts`

**Changes:**
```typescript
interface RoutingOptions {
  explicitBackend?: string;
  allowFallback?: boolean;
  accountContext?: {              // NEW
    subscriptionId: string;
    configDir: string;
  };
}

FUNCTION route(request, options):
  IF options.accountContext:
    backend = mapSubscriptionToBackend(options.accountContext.subscriptionId);
    RETURN { backend, reason: "Auth pool allocation" };
  END IF
  // ... existing logic
END FUNCTION
```

**Lines Changed:** ~25 lines

---

### `src/lib/backend-registry.ts`

**Changes:**
```typescript
// Add field to BackendConfig
interface BackendConfig {
  name: string;
  type: string;
  subscriptionId?: string;  // NEW
  // ... existing fields
}
```

**Lines Changed:** ~5 lines

---

### `config/backends.json`

**Changes:**
```json
{
  "backends": [
    {
      "name": "claude-cli-sub1",
      "subscriptionId": "sub1",
      "configDir": "/Users/vmks/.claude-sub1"
    }
  ],
  "authPool": {
    "enabled": true,
    "maxClientsPerSubscription": 15
  }
}
```

**Lines Changed:** ~15 lines

---

## Configuration Files

### `config/auth-pool.yaml`

**Purpose:** Auth pool configuration (separate from backends.json)

**Structure:**
```yaml
subscriptions:
  - id: sub1
    email: user1@example.com
    type: claude-pro
    configDir: /Users/vmks/.claude-sub1
    weeklyBudget: 456.00

safeguards:
  maxClientsPerSubscription: 15
  weeklyBudgetThreshold: 0.85
  fallbackWhenExhausted: true

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

**Size:** ~50 lines

---

## Test Files

### Unit Tests (~1000 lines total)

- `health-calculator.test.ts` (~150 lines)
- `usage-tracker.test.ts` (~200 lines)
- `allocation-balancer.test.ts` (~250 lines)
- `session-store.test.ts` (~150 lines)
- `block-calculator.test.ts` (~100 lines)
- `validators.test.ts` (~150 lines)

### Integration Tests (~500 lines total)

- `subscription-lifecycle.test.ts` (~150 lines)
- `allocation-flow.test.ts` (~150 lines)
- `rebalancing.test.ts` (~150 lines)
- `storage.test.ts` (~50 lines)

### E2E Tests (~300 lines total)

- `full-flow.test.ts` (~150 lines)
- `failover.test.ts` (~75 lines)
- `rotation.test.ts` (~75 lines)

---

## Scripts

### `scripts/auth-pool/setup-subscriptions.sh`

**Purpose:** Initialize subscription configs

```bash
#!/bin/bash
# Create Claude config directories for each subscription
# Copy settings.json templates
# Validate connectivity
```

**Size:** ~50 lines

---

### `scripts/auth-pool/test-allocation.sh`

**Purpose:** Manual allocation testing

```bash
#!/bin/bash
# Send test requests to API
# Verify subscription selection
# Check usage tracking
```

**Size:** ~100 lines

---

### `scripts/auth-pool/monitor-usage.sh`

**Purpose:** Real-time usage monitoring

```bash
#!/bin/bash
# Tail logs
# Query Durable Object state
# Display health scores
```

**Size:** ~75 lines

---

## Code Statistics

### New Code

| Component | Files | Est. Lines | Complexity |
|-----------|-------|------------|------------|
| Core modules | 6 | ~1,900 | High |
| Storage | 3 | ~450 | Medium |
| Utils | 3 | ~430 | Low |
| Types | 1 | ~400 | Low |
| Middleware | 1 | ~150 | Medium |
| **Subtotal** | **14** | **~3,330** | |

### Modified Code

| File | Lines Changed | Complexity |
|------|---------------|------------|
| src/index.ts | ~20 | Low |
| src/routes/chat.ts | ~30 | Low |
| src/lib/router.ts | ~25 | Low |
| src/lib/backend-registry.ts | ~5 | Low |
| config/backends.json | ~15 | Low |
| **Subtotal** | **~95** | |

### Tests

| Type | Files | Est. Lines |
|------|-------|------------|
| Unit | 6 | ~1,000 |
| Integration | 4 | ~500 |
| E2E | 3 | ~300 |
| **Subtotal** | **13** | **~1,800** |

### Total

| Category | Files | Lines |
|----------|-------|-------|
| **New Code** | 14 | ~3,330 |
| **Modified Code** | 5 | ~95 |
| **Tests** | 13 | ~1,800 |
| **Documentation** | 7 | ~2,500 |
| **Scripts** | 3 | ~225 |
| **Config** | 1 | ~50 |
| **TOTAL** | **43** | **~8,000** |

---

## Build and Deployment

### Development Workflow

1. **Setup:** `npm install` (add auth-pool dependencies)
2. **Build:** `npm run build` (TypeScript compilation)
3. **Test:** `npm test` (run all tests)
4. **Lint:** `npm run lint` (ESLint + Prettier)
5. **Dev:** `npm run dev` (watch mode)

### Dependencies (package.json additions)

```json
{
  "dependencies": {
    "yaml": "^2.3.4"
  }
}
```

No additional dependencies needed (Zod already in project).

---

## File Creation Order (Implementation Phase)

### Phase 1: Foundation
1. `types.ts`
2. `storage/storage-interface.ts`
3. `storage/memory-store.ts`
4. `utils/validators.ts`
5. `utils/time-utils.ts`
6. `utils/block-calculator.ts`

### Phase 2: Core Logic
7. `core/health-calculator.ts`
8. `core/subscription-manager.ts`
9. `core/usage-tracker.ts`
10. `core/session-store.ts`
11. `core/notification-manager.ts`
12. `core/allocation-balancer.ts`

### Phase 3: Integration
13. `middleware.ts`
14. `index.ts` (module exports)
15. Modify `src/index.ts`
16. Modify `src/routes/chat.ts`
17. Modify `src/lib/router.ts`

### Phase 4: Production Storage
18. `storage/durable-object-store.ts`

### Phase 5: Configuration & Scripts
19. `config/auth-pool.yaml`
20. Modify `config/backends.json`
21. Scripts (setup, test, monitor)

---

**Document Status:** ✅ Project Structure Complete - Ready for Pseudocode
