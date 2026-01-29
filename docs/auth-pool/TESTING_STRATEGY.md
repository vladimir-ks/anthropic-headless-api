# Auth Pool Testing Strategy

**Status:** 🧪 Test Specification
**Last Updated:** 2026-01-28
**Purpose:** Comprehensive testing approach (Unit/Integration/E2E)

---

## Testing Philosophy

**Test-Driven Development (TDD):**
1. Write tests FIRST (before implementation)
2. Tests should FAIL initially (red state)
3. Implement code to make tests pass (green state)
4. Refactor code while keeping tests green

**Coverage Goals:**
- Unit tests: 90%+ coverage
- Integration tests: All critical flows
- E2E tests: All user scenarios

---

## 1. Unit Tests

**Goal:** Test individual modules in isolation

### 1.1 Health Calculator Tests

**File:** `tests/auth-pool/unit/health-calculator.test.ts`

**Test Cases:**

```typescript
DESCRIBE "HealthCalculator":
  DESCRIBE "calculate()":
    TEST "should return 100 for unused subscription":
      subscription = createMockSubscription({
        currentBlockCost: 0,
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0
      })

      calculator = new HealthCalculator(config)
      score = calculator.calculate(subscription)

      EXPECT score TO_EQUAL 110  // 100 + 10 idle bonus
    END TEST

    TEST "should penalize high weekly usage":
      subscription = createMockSubscription({
        weeklyUsed: 400,        // 88% of 456
        weeklyBudget: 456,
        currentBlockCost: 0,
        assignedClients: [],
        burnRate: 0
      })

      score = calculator.calculate(subscription)

      // 100 - (88 * 0.5) - 0 - 0 - 0 + 10 = 66
      EXPECT score TO_BE_CLOSE_TO 66
    END TEST

    TEST "should penalize high block usage":
      subscription = createMockSubscription({
        currentBlockCost: 20,   // 80% of expected 25
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0
      })

      score = calculator.calculate(subscription)

      // 100 - 0 - (80 * 0.3) - 0 - 0 + 0 = 76
      EXPECT score TO_BE_CLOSE_TO 76
    END TEST

    TEST "should penalize client count":
      subscription = createMockSubscription({
        assignedClients: ['c1', 'c2', 'c3'],  // 3 clients
        weeklyUsed: 0,
        currentBlockCost: 0,
        burnRate: 0
      })

      score = calculator.calculate(subscription)

      // 100 - 0 - 0 - (3 * 5) - 0 + 10 = 95
      EXPECT score TO_EQUAL 95
    END TEST

    TEST "should penalize high burn rate":
      subscription = createMockSubscription({
        burnRate: 7.0,  // 4 above baseline of 3
        weeklyUsed: 0,
        currentBlockCost: 0,
        assignedClients: []
      })

      score = calculator.calculate(subscription)

      // 100 - 0 - 0 - 0 - ((7 - 3) * 2) + 10 = 102
      EXPECT score TO_EQUAL 102
    END TEST

    TEST "should clamp score to 0-100 range":
      subscription = createMockSubscription({
        weeklyUsed: 450,     // 99%
        currentBlockCost: 25,
        assignedClients: ['c1', 'c2', 'c3', 'c4', 'c5'],
        burnRate: 10.0
      })

      score = calculator.calculate(subscription)

      EXPECT score TO_BE_GREATER_THAN_OR_EQUAL 0
      EXPECT score TO_BE_LESS_THAN_OR_EQUAL 100
    END TEST
  END DESCRIBE

  DESCRIBE "explainScore()":
    TEST "should provide detailed breakdown":
      subscription = createMockSubscription({
        weeklyUsed: 200,
        weeklyBudget: 456,
        currentBlockCost: 10,
        assignedClients: ['c1', 'c2'],
        burnRate: 5.0
      })

      breakdown = calculator.explainScore(subscription)

      EXPECT breakdown.components.weeklyUsagePenalty TO_BE_CLOSE_TO -21.9
      EXPECT breakdown.components.clientCountPenalty TO_EQUAL -10
      EXPECT breakdown.explanation TO_BE_ARRAY
      EXPECT breakdown.explanation.length TO_BE_GREATER_THAN 3
    END TEST
  END DESCRIBE
END DESCRIBE
```

**Lines:** ~150

---

### 1.2 Usage Tracker Tests

**File:** `tests/auth-pool/unit/usage-tracker.test.ts`

**Test Cases:**

```typescript
DESCRIBE "UsageTracker":
  DESCRIBE "recordUsage()":
    TEST "should create usage record from CLI output":
      cliOutput = {
        result: "Hello",
        session_id: "ses_123",
        total_cost_usd: 0.15,
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0
        },
        duration_ms: 5000,
        uuid: "uuid_123"
      }

      tracker = new UsageTracker(mockStorage)
      record = AWAIT tracker.recordUsage(cliOutput, "sub1")

      EXPECT record.subscriptionId TO_EQUAL "sub1"
      EXPECT record.costUSD TO_EQUAL 0.15
      EXPECT record.totalTokens TO_EQUAL 1500
      EXPECT record.blockId TO_BE_STRING
    END TEST

    TEST "should store usage record in storage":
      record = AWAIT tracker.recordUsage(cliOutput, "sub1")

      storageKey = "usage:sub1:" + record.timestamp
      storedRecord = AWAIT mockStorage.get(storageKey)

      EXPECT storedRecord TO_EQUAL record
    END TEST

    TEST "should update subscription state after recording":
      initialSub = createMockSubscription({
        id: "sub1",
        currentBlockCost: 0,
        weeklyUsed: 0
      })
      AWAIT mockStorage.set("subscription:sub1", initialSub)

      AWAIT tracker.recordUsage(cliOutput, "sub1")

      updatedSub = AWAIT mockStorage.get("subscription:sub1")
      EXPECT updatedSub.currentBlockCost TO_BE_GREATER_THAN 0
    END TEST
  END DESCRIBE

  DESCRIBE "getWeeklyUsage()":
    TEST "should aggregate last 7 days of usage":
      now = NOW()
      records = [
        { timestamp: now - (1 * DAY), costUSD: 10 },
        { timestamp: now - (3 * DAY), costUSD: 20 },
        { timestamp: now - (6 * DAY), costUSD: 15 },
        { timestamp: now - (8 * DAY), costUSD: 50 }  // Outside 7-day window
      ]

      FOR EACH record IN records:
        AWAIT mockStorage.set("usage:sub1:" + record.timestamp, record)
      END FOR

      weeklyTotal = AWAIT tracker.getWeeklyUsage("sub1")

      EXPECT weeklyTotal TO_EQUAL 45  // 10 + 20 + 15 (excludes 50)
    END TEST

    TEST "should return 0 for subscription with no usage":
      weeklyTotal = AWAIT tracker.getWeeklyUsage("sub_empty")
      EXPECT weeklyTotal TO_EQUAL 0
    END TEST
  END DESCRIBE

  DESCRIBE "getActiveBlock()":
    TEST "should return null if no usage in current block":
      blockInfo = AWAIT tracker.getActiveBlock("sub1")
      EXPECT blockInfo TO_BE_NULL
    END TEST

    TEST "should aggregate usage for current block":
      blockId = tracker.getActiveBlockId(NOW())

      records = [
        { costUSD: 5, totalTokens: 10000 },
        { costUSD: 3, totalTokens: 6000 }
      ]

      FOR EACH record IN records:
        record.blockId = blockId
        record.subscriptionId = "sub1"
        record.timestamp = NOW()
        AWAIT mockStorage.set("usage:sub1:" + record.timestamp, record)
      END FOR

      blockInfo = AWAIT tracker.getActiveBlock("sub1")

      EXPECT blockInfo.totalCost TO_EQUAL 8
      EXPECT blockInfo.totalTokens TO_EQUAL 16000
      EXPECT blockInfo.requestCount TO_EQUAL 2
    END TEST

    TEST "should calculate burn rate correctly":
      // Set up: 10 minutes elapsed, $5 spent
      // Burn rate should be $30/hour

      blockInfo = AWAIT tracker.getActiveBlock("sub1")
      EXPECT blockInfo.costPerHour TO_BE_CLOSE_TO 30
    END TEST
  END DESCRIBE

  DESCRIBE "getActiveBlockId()":
    TEST "should return correct block ID for 00:00 UTC":
      timestamp = createDate("2026-01-28T00:30:00.000Z")
      blockId = tracker.getActiveBlockId(timestamp)
      EXPECT blockId TO_EQUAL "2026-01-28T00:00:00.000Z"
    END TEST

    TEST "should return correct block ID for 05:00 UTC":
      timestamp = createDate("2026-01-28T05:15:00.000Z")
      blockId = tracker.getActiveBlockId(timestamp)
      EXPECT blockId TO_EQUAL "2026-01-28T05:00:00.000Z"
    END TEST

    TEST "should return correct block ID for 19:45 UTC":
      timestamp = createDate("2026-01-28T19:45:00.000Z")
      blockId = tracker.getActiveBlockId(timestamp)
      EXPECT blockId TO_EQUAL "2026-01-28T15:00:00.000Z"  // 15:00 block
    END TEST
  END DESCRIBE
END DESCRIBE
```

**Lines:** ~200

---

### 1.3 Allocation Balancer Tests

**File:** `tests/auth-pool/unit/allocation-balancer.test.ts`

**Test Cases:**

```typescript
DESCRIBE "AllocationBalancer":
  DESCRIBE "allocateSubscription()":
    TEST "should select subscription with highest health score":
      subscriptions = [
        createMockSubscription({ id: "sub1", healthScore: 45 }),
        createMockSubscription({ id: "sub2", healthScore: 78 }),
        createMockSubscription({ id: "sub3", healthScore: 60 })
      ]

      setupMockSubscriptions(subscriptions)

      result = AWAIT balancer.allocateSubscription({
        estimatedTokens: 10000
      })

      EXPECT result.type TO_EQUAL 'subscription'
      EXPECT result.subscriptionId TO_EQUAL "sub2"  // Highest score
    END TEST

    TEST "should fallback to API if all subscriptions exhausted":
      subscriptions = [
        createMockSubscription({ weeklyUsed: 430, weeklyBudget: 456 }),  // 94%
        createMockSubscription({ weeklyUsed: 440, weeklyBudget: 456 })   // 96%
      ]

      setupMockSubscriptions(subscriptions)

      result = AWAIT balancer.allocateSubscription({
        estimatedTokens: 10000
      })

      EXPECT result.type TO_EQUAL 'fallback'
      EXPECT result.fallbackProvider TO_EQUAL "openrouter-glm"
    END TEST

    TEST "should resume existing session":
      existingSession = createMockSession({
        id: "ses_123",
        subscriptionId: "sub1"
      })

      AWAIT mockSessionStore.createSession("ses_123", "sub1")

      result = AWAIT balancer.allocateSubscription({
        sessionId: "ses_123",
        estimatedTokens: 10000
      })

      EXPECT result.sessionId TO_EQUAL "ses_123"
      EXPECT result.subscriptionId TO_EQUAL "sub1"
    END TEST

    TEST "should respect client count limit":
      subscription = createMockSubscription({
        id: "sub1",
        assignedClients: ['c1', 'c2', '... c15'],  // 15 clients
        maxClientsPerSub: 15
      })

      setupMockSubscriptions([subscription])

      result = AWAIT balancer.allocateSubscription({
        estimatedTokens: 10000
      })

      EXPECT result.type TO_EQUAL 'fallback'  // Can't allocate to sub1
    END TEST

    TEST "should create session and assign to subscription":
      subscription = createMockSubscription({ id: "sub1" })
      setupMockSubscriptions([subscription])

      result = AWAIT balancer.allocateSubscription({
        estimatedTokens: 10000
      })

      session = AWAIT mockSessionStore.getSession(result.sessionId)
      EXPECT session TO_NOT_BE_NULL
      EXPECT session.subscriptionId TO_EQUAL "sub1"

      updatedSub = AWAIT mockSubscriptionManager.getSubscription("sub1")
      EXPECT updatedSub.assignedClients TO_INCLUDE result.sessionId
    END TEST
  END DESCRIBE

  DESCRIBE "rebalanceAllocations()":
    TEST "should not rebalance if no imbalance detected":
      subscriptions = [
        createMockSubscription({ id: "sub1", weeklyUsed: 100 }),
        createMockSubscription({ id: "sub2", weeklyUsed: 102 })  // $2 gap
      ]

      setupMockSubscriptions(subscriptions)

      report = AWAIT balancer.rebalanceAllocations()

      EXPECT report.imbalanceDetected TO_BE_FALSE
      EXPECT report.clientsMoved TO_EQUAL 0
    END TEST

    TEST "should move clients when imbalance detected":
      subscriptions = [
        createMockSubscription({
          id: "sub1",
          weeklyUsed: 200,  // High usage
          assignedClients: ['c1', 'c2', 'c3']
        }),
        createMockSubscription({
          id: "sub2",
          weeklyUsed: 50,   // Low usage
          assignedClients: []
        })
      ]

      setupMockSubscriptions(subscriptions)

      // Create idle sessions for sub1
      AWAIT mockSessionStore.createSession("c1", "sub1")
      AWAIT mockSessionStore.createSession("c2", "sub1")
      AWAIT mockSessionStore.updateSession("c1", { status: 'idle' })
      AWAIT mockSessionStore.updateSession("c2", { status: 'idle' })

      report = AWAIT balancer.rebalanceAllocations()

      EXPECT report.imbalanceDetected TO_BE_TRUE
      EXPECT report.clientsMoved TO_BE_GREATER_THAN 0
      EXPECT report.movementDetails TO_BE_ARRAY
    END TEST

    TEST "should respect maxClientsToMovePerCycle":
      // Setup: 10 idle clients, but max 3 per cycle

      report = AWAIT balancer.rebalanceAllocations()

      EXPECT report.clientsMoved TO_BE_LESS_THAN_OR_EQUAL 3
    END TEST
  END DESCRIBE
END DESCRIBE
```

**Lines:** ~250

---

### 1.4 Session Store Tests

**File:** `tests/auth-pool/unit/session-store.test.ts`

**Test Cases:**

```typescript
DESCRIBE "SessionStore":
  DESCRIBE "createSession()":
    TEST "should create new session":
      store = new SessionStore(mockStorage)

      session = AWAIT store.createSession("ses_123", "sub1")

      EXPECT session.id TO_EQUAL "ses_123"
      EXPECT session.subscriptionId TO_EQUAL "sub1"
      EXPECT session.status TO_EQUAL 'active'
      EXPECT session.sessionCost TO_EQUAL 0
    END TEST

    TEST "should add session to index":
      AWAIT store.createSession("ses_123", "sub1")

      index = AWAIT mockStorage.getIndex("index:sessions_by_sub:sub1")
      EXPECT index TO_INCLUDE "ses_123"
    END TEST
  END DESCRIBE

  DESCRIBE "getSession()":
    TEST "should return session if exists":
      AWAIT store.createSession("ses_123", "sub1")

      session = AWAIT store.getSession("ses_123")

      EXPECT session TO_NOT_BE_NULL
      EXPECT session.id TO_EQUAL "ses_123"
    END TEST

    TEST "should return null if not exists":
      session = AWAIT store.getSession("nonexistent")
      EXPECT session TO_BE_NULL
    END TEST

    TEST "should calculate status from lastActivity":
      AWAIT store.createSession("ses_123", "sub1")

      // Wait 10 minutes
      AWAIT mockStorage.set("session:ses_123", {
        ...session,
        lastActivity: NOW() - (10 * 60 * 1000)
      })

      session = AWAIT store.getSession("ses_123")
      EXPECT session.status TO_EQUAL 'idle'
    END TEST
  END DESCRIBE

  DESCRIBE "expireStaleSessions()":
    TEST "should delete sessions older than maxAge":
      now = NOW()

      sessions = [
        { id: "s1", lastActivity: now - (30 * 60 * 1000) },  // 30 min (keep)
        { id: "s2", lastActivity: now - (90 * 60 * 1000) }   // 90 min (delete)
      ]

      FOR EACH s IN sessions:
        AWAIT mockStorage.set("session:" + s.id, s)
      END FOR

      expiredCount = AWAIT store.expireStaleSessions(60 * 60 * 1000)  // 60 min

      EXPECT expiredCount TO_EQUAL 1

      s1 = AWAIT store.getSession("s1")
      s2 = AWAIT store.getSession("s2")

      EXPECT s1 TO_NOT_BE_NULL
      EXPECT s2 TO_BE_NULL
    END TEST
  END DESCRIBE
END DESCRIBE
```

**Lines:** ~150

---

## 2. Integration Tests

**Goal:** Test module interactions

### 2.1 Subscription Lifecycle Test

**File:** `tests/auth-pool/integration/subscription-lifecycle.test.ts`

**Test Scenario:**

```typescript
DESCRIBE "Subscription Lifecycle":
  TEST "complete subscription workflow":
    // 1. Initialize subscription manager
    manager = new SubscriptionManager(storage, config)
    AWAIT manager.initialize()

    // 2. Verify subscriptions loaded
    subscriptions = AWAIT manager.getAllSubscriptions()
    EXPECT subscriptions.length TO_EQUAL 2

    // 3. Record usage
    tracker = new UsageTracker(storage)
    cliOutput = createMockCLIOutput({ cost: 10 })
    AWAIT tracker.recordUsage(cliOutput, "sub1")

    // 4. Verify subscription updated
    sub1 = AWAIT manager.getSubscription("sub1")
    EXPECT sub1.currentBlockCost TO_EQUAL 10

    // 5. Record more usage (cross into new block)
    mockTime(NOW() + 6 * HOURS)  // Move to next block
    AWAIT tracker.recordUsage(cliOutput, "sub1")

    // 6. Verify block reset
    sub1 = AWAIT manager.getSubscription("sub1")
    EXPECT sub1.currentBlockCost TO_EQUAL 10  // Reset for new block

    // 7. Cleanup
    AWAIT manager.shutdown()
  END TEST
END DESCRIBE
```

**Lines:** ~150

---

### 2.2 Allocation Flow Test

**File:** `tests/auth-pool/integration/allocation-flow.test.ts`

**Test Scenario:**

```typescript
DESCRIBE "Allocation Flow":
  TEST "should allocate, use, and release subscription":
    // Setup
    setupIntegrationTest()

    // 1. Allocate subscription
    result = AWAIT balancer.allocateSubscription({
      estimatedTokens: 10000
    })

    EXPECT result.type TO_EQUAL 'subscription'
    sessionId = result.sessionId

    // 2. Simulate usage
    cliOutput = createMockCLIOutput({
      session_id: sessionId,
      cost: 5
    })

    AWAIT tracker.recordUsage(cliOutput, result.subscriptionId)

    // 3. Verify usage tracked
    session = AWAIT sessionStore.getSession(sessionId)
    EXPECT session.sessionCost TO_EQUAL 5

    // 4. Release allocation
    AWAIT balancer.releaseAllocation(sessionId)

    // 5. Verify cleanup
    session = AWAIT sessionStore.getSession(sessionId)
    EXPECT session TO_BE_NULL
  END TEST

  TEST "should rotate to different subscription on high usage":
    // Setup: sub1 at 90%, sub2 at 10%

    // 1. First allocation (should get sub2 - healthier)
    result1 = AWAIT balancer.allocateSubscription({
      estimatedTokens: 10000
    })
    EXPECT result1.subscriptionId TO_EQUAL "sub2"

    // 2. Simulate heavy usage on sub2 (push to 90%)
    FOR i = 1 TO 50:
      AWAIT tracker.recordUsage(mockCLIOutput, "sub2")
    END FOR

    // 3. New allocation (should now get sub1 or fallback)
    result2 = AWAIT balancer.allocateSubscription({
      estimatedTokens: 10000
    })

    EXPECT result2.subscriptionId TO_NOT_EQUAL "sub2"
  END TEST
END DESCRIBE
```

**Lines:** ~150

---

### 2.3 Rebalancing Test

**File:** `tests/auth-pool/integration/rebalancing.test.ts`

**Test Scenario:**

```typescript
DESCRIBE "Rebalancing":
  TEST "should rebalance load periodically":
    // Setup: sub1 heavily used, sub2 lightly used

    // 1. Create 10 sessions on sub1
    FOR i = 1 TO 10:
      AWAIT balancer.allocateSubscription({
        sessionId: "ses_" + i,
        estimatedTokens: 1000
      })
    END FOR

    // 2. Mark half as idle
    FOR i = 1 TO 5:
      AWAIT sessionStore.updateSession("ses_" + i, { status: 'idle' })
    END FOR

    // 3. Trigger rebalancing
    report = AWAIT balancer.rebalanceAllocations()

    // 4. Verify clients moved
    EXPECT report.imbalanceDetected TO_BE_TRUE
    EXPECT report.clientsMoved TO_BE_GREATER_THAN 0

    // 5. Verify health scores improved
    sub1ScoreBefore = report.healthScoresBefore['sub1']
    sub1ScoreAfter = report.healthScoresAfter['sub1']

    EXPECT sub1ScoreAfter TO_BE_GREATER_THAN sub1ScoreBefore
  END TEST
END DESCRIBE
```

**Lines:** ~150

---

## 3. E2E Tests

**Goal:** Test complete request flow with real Claude CLI

### 3.1 Full Flow Test

**File:** `tests/auth-pool/e2e/full-flow.test.ts`

**Test Scenario:**

```typescript
DESCRIBE "End-to-End Flow":
  TEST "complete request flow with real Claude CLI":
    // Setup: Start API with auth pool enabled
    api = startAPI({ authPoolEnabled: true })

    // 1. Send request to API
    response = AWAIT fetch('http://localhost:3000/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        tools: ['bash']  // Requires Claude CLI
      })
    })

    // 2. Verify response
    data = AWAIT response.json()

    EXPECT response.status TO_EQUAL 200
    EXPECT data.choices[0].message.content TO_INCLUDE '4'
    EXPECT data.claude_metadata TO_EXIST
    EXPECT data.claude_metadata.cost TO_BE_GREATER_THAN 0

    // 3. Verify usage tracked
    // (Check subscription state in Durable Object)

    // 4. Send follow-up request (same session)
    response2 = AWAIT fetch(url, {
      body: JSON.stringify({
        session_id: data.session_id,
        messages: [{ role: 'user', content: 'What about 3+3?' }]
      })
    })

    data2 = AWAIT response2.json()

    // 5. Verify session continuity
    EXPECT data2.session_id TO_EQUAL data.session_id

    // 6. Cleanup
    AWAIT api.shutdown()
  END TEST
END DESCRIBE
```

**Lines:** ~150

---

### 3.2 Failover Test

**File:** `tests/auth-pool/e2e/failover.test.ts`

**Test Scenario:**

```typescript
DESCRIBE "Failover":
  TEST "should fallback to API when all subscriptions exhausted":
    // Setup: 2 subscriptions, both at 96% weekly usage

    api = startAPI({ authPoolEnabled: true })

    // 1. Send request
    response = AWAIT fetch(url, {
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        messages: [{ role: 'user', content: 'Hello' }],
        tools: []  // No tools required
      })
    })

    data = AWAIT response.json()

    // 2. Verify fallback used
    EXPECT response.status TO_EQUAL 200
    EXPECT data.backend TO_NOT_INCLUDE 'claude-cli'  // Should use API backend

    // 3. Verify notification sent
    // (Check webhook received failover event)
  END TEST
END DESCRIBE
```

**Lines:** ~75

---

## 4. Test Utilities

### Mock Factories

```typescript
FUNCTION createMockSubscription(overrides: Partial<Subscription>) RETURNS Subscription:
  RETURN {
    id: "sub1",
    email: "user@example.com",
    type: 'claude-pro',
    configDir: "/tmp/.claude-sub1",
    currentBlockId: NULL,
    currentBlockCost: 0,
    weeklyBudget: 456,
    weeklyUsed: 0,
    assignedClients: [],
    maxClientsPerSub: 15,
    healthScore: 100,
    status: 'available',
    burnRate: 0,
    tokensPerMinute: 0,
    lastUsageUpdate: NOW(),
    lastRequestTime: 0,
    createdAt: NOW(),
    ...overrides
  }
END FUNCTION

FUNCTION createMockCLIOutput(overrides: Partial<ClaudeCliJsonOutput>) RETURNS ClaudeCliJsonOutput:
  RETURN {
    result: "Hello",
    session_id: "ses_" + generateUUID(),
    total_cost_usd: 0.10,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0
    },
    duration_ms: 5000,
    uuid: generateUUID(),
    is_error: FALSE,
    ...overrides
  }
END FUNCTION
```

---

## 5. Manual QA Scenarios

### Scenario 1: Subscription Allocation

**Steps:**
1. Start API with 2 subscriptions
2. Send 10 requests
3. Verify requests distributed evenly

**Expected:** ~5 requests to each subscription

---

### Scenario 2: Weekly Budget Exhaustion

**Steps:**
1. Set weeklyBudget = $10
2. Send requests until $10 spent
3. Send another request

**Expected:** Request uses fallback API, notification sent

---

### Scenario 3: Rebalancing

**Steps:**
1. Allocate 10 clients to sub1
2. Wait 5 minutes (rebalancing interval)
3. Check subscription assignments

**Expected:** Clients distributed more evenly

---

## 6. CI/CD Integration

**GitHub Actions Workflow:**

```yaml
name: Auth Pool Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install

      - name: Run unit tests
        run: npm run test:unit -- --coverage

      - name: Run integration tests
        run: npm run test:integration

      - name: Run E2E tests (with real Claude CLI)
        run: npm run test:e2e
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

---

## 7. Performance Testing

**Goal:** Ensure auth pool doesn't introduce latency

**Test:**

```typescript
DESCRIBE "Performance":
  TEST "allocation should complete in <10ms":
    start = NOW()

    AWAIT balancer.allocateSubscription({ estimatedTokens: 10000 })

    duration = NOW() - start

    EXPECT duration TO_BE_LESS_THAN 10  // milliseconds
  END TEST

  TEST "1000 concurrent allocations should complete in <5s":
    start = NOW()

    promises = []
    FOR i = 1 TO 1000:
      promises.push(balancer.allocateSubscription({ estimatedTokens: 1000 }))
    END FOR

    AWAIT Promise.all(promises)

    duration = NOW() - start

    EXPECT duration TO_BE_LESS_THAN 5000  // 5 seconds
  END TEST
END DESCRIBE
```

---

**Document Status:** ✅ Testing Strategy Complete - Ready for Plan Refactoring
