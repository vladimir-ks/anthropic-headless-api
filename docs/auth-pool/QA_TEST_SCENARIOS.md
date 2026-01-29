# Auth Pool - Human QA Test Scenarios

Comprehensive manual testing guide for QA team validation.

---

## Prerequisites

- Auth pool configured with 3 subscriptions (sub1, sub2, sub3)
- Each subscription has different usage levels
- anthropic-headless-api server running
- Access to debug endpoint: `GET /debug/auth-pool`

---

## Scenario 1: Basic Allocation Flow

**Objective**: Verify client allocation works correctly

**Steps**:
1. Start fresh server (clear all state)
2. Send first API request:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "messages": [{"role": "user", "content": "Hello"}],
       "session_id": "test-session-1"
     }'
   ```

**Expected Results**:
- ✅ Response received successfully
- ✅ Logs show: `Allocated session { clientId: "test-session-1", subscriptionId: "sub1|sub2|sub3" }`
- ✅ Debug endpoint shows client assigned to a subscription
- ✅ Response time < 500ms

**Failure Indicators**:
- ❌ Response uses fallback API (should use subscription)
- ❌ No allocation log message
- ❌ Error in logs

---

## Scenario 2: Load Distribution

**Objective**: Verify clients are distributed across subscriptions

**Steps**:
1. Start fresh server
2. Send 10 concurrent requests with different session IDs:
   ```bash
   for i in {1..10}; do
     curl -X POST http://localhost:3000/v1/chat/completions \
       -H "Content-Type: application/json" \
       -d "{\"messages\": [{\"role\": \"user\", \"content\": \"Hello $i\"}], \"session_id\": \"session-$i\"}" &
   done
   wait
   ```
3. Check distribution: `curl http://localhost:3000/debug/auth-pool`

**Expected Results**:
- ✅ All 10 requests succeed
- ✅ Clients distributed across 2-3 subscriptions (not all on one)
- ✅ Each subscription has 3-5 clients assigned
- ✅ No subscription exceeds max clients limit (15)

**Failure Indicators**:
- ❌ All clients on single subscription
- ❌ Subscription exceeds 15 clients
- ❌ Some requests fail

---

## Scenario 3: Usage Tracking

**Objective**: Verify usage is recorded correctly after each request

**Steps**:
1. Check initial usage: `curl http://localhost:3000/debug/auth-pool`
2. Note `weeklyUsed` and `currentBlockCost` for sub1
3. Send request using sub1:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "messages": [{"role": "user", "content": "Write a long story"}],
       "session_id": "test-session-sub1"
     }'
   ```
4. Check usage again: `curl http://localhost:3000/debug/auth-pool`

**Expected Results**:
- ✅ `weeklyUsed` increased (should be > previous value)
- ✅ `currentBlockCost` increased
- ✅ `lastUsageUpdate` timestamp updated
- ✅ Logs show: `Recorded usage: $X.XXX { subscriptionId: "sub1", ... }`

**Failure Indicators**:
- ❌ Usage not recorded (values unchanged)
- ❌ Cost is 0
- ❌ No usage log message

---

## Scenario 4: Weekly Budget Threshold

**Objective**: Verify fallback when subscription exceeds budget threshold

**Steps**:
1. Manually set sub1 weeklyUsed to 388 (85% of 456):
   - Edit config or use debug endpoint if available
2. Set sub2 and sub3 weeklyUsed to 390 (also above threshold)
3. Send request:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "messages": [{"role": "user", "content": "Test"}],
       "session_id": "test-fallback"
     }'
   ```

**Expected Results**:
- ✅ Request succeeds (uses fallback API)
- ✅ Logs show: `Using fallback: All subscriptions unavailable`
- ✅ Response indicates fallback backend used
- ✅ No allocation to exhausted subscription

**Failure Indicators**:
- ❌ Request allocated to exhausted subscription
- ❌ Request fails
- ❌ No fallback indication

---

## Scenario 5: Rebalancing

**Objective**: Verify periodic rebalancing moves clients

**Setup**:
1. Allocate 5 clients to sub1
2. Wait for them to go idle (no active requests)
3. Manually increase sub1 usage to $30
4. Keep sub2 usage at $5
5. Wait 5+ minutes for rebalancing cycle

**Expected Results**:
- ✅ Logs show: `Rebalancing needed { costGap: "25.00" }`
- ✅ Logs show: `Moved X clients { fromSubscription: "sub1", toSubscription: "sub2", ... }`
- ✅ Debug endpoint shows clients moved from sub1 to sub2
- ✅ Cost gap reduced

**Failure Indicators**:
- ❌ No rebalancing after 5 minutes
- ❌ Active clients moved (should only move idle)
- ❌ No log messages

---

## Scenario 6: Client Capacity Limit

**Objective**: Verify subscription doesn't exceed max clients

**Steps**:
1. Set sub1 maxClientsPerSub to 3
2. Allocate 3 clients to sub1:
   ```bash
   for i in {1..3}; do
     curl -X POST http://localhost:3000/v1/chat/completions \
       -H "Content-Type: application/json" \
       -d "{\"messages\": [{\"role\": \"user\", \"content\": \"Test\"}], \"session_id\": \"sub1-client-$i\"}"
   done
   ```
3. Try to allocate 4th client:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "messages": [{"role": "user", "content": "Test"}],
       "session_id": "sub1-client-4"
     }'
   ```

**Expected Results**:
- ✅ First 3 clients allocated to sub1
- ✅ 4th client allocated to sub2 or sub3 (not sub1)
- ✅ sub1 never exceeds 3 clients

**Failure Indicators**:
- ❌ sub1 shows 4+ clients
- ❌ Request fails

---

## Scenario 7: Health Score Accuracy

**Objective**: Verify health scores reflect actual subscription state

**Steps**:
1. Set different usage levels:
   - sub1: weeklyUsed = 400, currentBlockCost = 20, assignedClients = 5
   - sub2: weeklyUsed = 200, currentBlockCost = 10, assignedClients = 2
   - sub3: weeklyUsed = 100, currentBlockCost = 5, assignedClients = 0
2. Check: `curl http://localhost:3000/debug/auth-pool`

**Expected Results**:
- ✅ sub3 has highest health score (~90-100)
- ✅ sub2 has medium health score (~70-80)
- ✅ sub1 has lowest health score (~40-60)
- ✅ Scores reflect usage accurately

**Failure Indicators**:
- ❌ All scores identical
- ❌ Inverse relationship (high usage = high score)

---

## Scenario 8: Webhook Notifications

**Objective**: Verify notifications sent when thresholds crossed

**Prerequisites**: Configure webhook URL in `config/auth-pool.json`

**Steps**:
1. Set sub1 weeklyUsed to 365 (80% of 456)
2. Record usage that pushes it over 80%:
   ```bash
   curl -X POST http://localhost:3000/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{
       "messages": [{"role": "user", "content": "Trigger notification"}],
       "session_id": "notify-test"
     }'
   ```
3. Check webhook endpoint for received notifications

**Expected Results**:
- ✅ Webhook receives POST request
- ✅ Payload contains:
   ```json
   {
     "type": "usage_threshold",
     "severity": "warning",
     "subscriptionId": "sub1",
     "message": "Subscription sub1 at 80% weekly budget",
     "data": {
       "weeklyUsed": 388,
       "weeklyBudget": 456,
       "estimatedTimeUntilExhaustion": "..."
     }
   }
   ```

**Failure Indicators**:
- ❌ No webhook received
- ❌ Incorrect payload format
- ❌ Missing required fields

---

## Scenario 9: Concurrent Requests

**Objective**: Verify system handles concurrent load

**Steps**:
1. Send 50 concurrent requests:
   ```bash
   for i in {1..50}; do
     curl -X POST http://localhost:3000/v1/chat/completions \
       -H "Content-Type: application/json" \
       -d "{\"messages\": [{\"role\": \"user\", \"content\": \"Test $i\"}], \"session_id\": \"concurrent-$i\"}" &
   done
   wait
   ```

**Expected Results**:
- ✅ All 50 requests succeed
- ✅ No race conditions or errors
- ✅ Clients distributed across all 3 subscriptions
- ✅ No subscription exceeds capacity
- ✅ Response times < 1 second

**Failure Indicators**:
- ❌ Some requests fail
- ❌ Race condition errors in logs
- ❌ Duplicate client IDs

---

## Scenario 10: Session Deallocation

**Objective**: Verify sessions are properly cleaned up

**Steps**:
1. Allocate client: `session-cleanup-test`
2. Check allocation: `curl http://localhost:3000/debug/auth-pool`
3. Trigger deallocation (simulate session end)
4. Check again: `curl http://localhost:3000/debug/auth-pool`

**Expected Results**:
- ✅ Client appears in assignedClients after allocation
- ✅ Client removed from assignedClients after deallocation
- ✅ Logs show: `Deallocated session { clientId: "session-cleanup-test", ... }`
- ✅ No memory leak (repeated allocations don't accumulate)

**Failure Indicators**:
- ❌ Client not removed from subscription
- ❌ Memory grows over time
- ❌ Sessions accumulate

---

## Scenario 11: Config Validation

**Objective**: Verify invalid configs are rejected

**Steps**:
1. Create invalid config with directory traversal:
   ```json
   {
     "subscriptions": [{
       "id": "evil",
       "email": "test@example.com",
       "type": "claude-pro",
       "configDir": "../../etc/passwd",
       "weeklyBudget": 456
     }]
   }
   ```
2. Restart server with this config

**Expected Results**:
- ✅ Server logs: `Invalid config directory for subscription evil`
- ✅ Auth pool initialization fails gracefully
- ✅ Server continues without auth pool (uses fallback)
- ✅ No file system access to /etc/passwd

**Failure Indicators**:
- ❌ Invalid config accepted
- ❌ Server crashes
- ❌ Security vulnerability exploited

---

## Scenario 12: Webhook URL Validation

**Objective**: Verify webhook security validation

**Steps**:
1. Configure HTTP (not HTTPS) webhook in production
2. Set NODE_ENV=production
3. Start server

**Expected Results**:
- ✅ Logs show: `Webhook URL should use HTTPS in production`
- ✅ Server continues (doesn't crash)
- ✅ Notifications may not be sent (or sent with warning)

**Failure Indicators**:
- ❌ No warning logged
- ❌ HTTP webhook accepted silently in production

---

## Performance Benchmarks

### Expected Performance Metrics

| Operation | Target | Threshold |
|-----------|--------|-----------|
| Allocation | <10ms | <15ms |
| Usage Recording | <5ms | <10ms |
| Health Calculation | <5ms | <10ms |
| Rebalancing Cycle | <100ms | <200ms |
| Memory per Session | ~500 bytes | <1 KB |
| Memory per Subscription | ~1 KB | <2 KB |

### Memory Leak Detection

**Test**: Allocate and deallocate 1000 sessions, measure memory before/after.

**Expected**: Memory returns to baseline (±10%)

**Command**:
```bash
# Record baseline
curl http://localhost:3000/debug/memory

# Allocate 1000 sessions
for i in {1..1000}; do
  curl -X POST http://localhost:3000/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d "{\"messages\": [{\"role\": \"user\", \"content\": \"Test\"}], \"session_id\": \"leak-test-$i\"}"
done

# Deallocate all (trigger cleanup)
# ... deallocation mechanism ...

# Check memory again
curl http://localhost:3000/debug/memory
```

---

## Regression Test Checklist

Before each release, verify:

- [ ] All 12 scenarios pass
- [ ] Performance benchmarks met
- [ ] No memory leaks detected
- [ ] Logs contain no errors during normal operation
- [ ] Debug endpoint returns valid JSON
- [ ] Webhooks received (if configured)
- [ ] Rebalancing occurs within 5-6 minutes
- [ ] No race conditions under concurrent load
- [ ] Config validation prevents security issues

---

## Troubleshooting Guide

### Allocation Always Uses Fallback

**Check**:
```bash
curl http://localhost:3000/debug/auth-pool | jq '.status[] | select(.status == "limited")'
```

**Fix**: If all subscriptions limited, wait for weekly reset or add more subscriptions.

### Rebalancing Not Working

**Check logs for**: `Rebalancing needed`

**Verify**:
- Rebalancing enabled in config
- Cost gap > $5 between subscriptions
- Idle clients exist to move

### Notifications Not Received

**Check logs for**: `Failed to send notification`

**Verify**:
- Webhook URL valid and reachable
- HTTPS in production
- Notification rules enabled in config

### Memory Growing Over Time

**Check**: `curl http://localhost:3000/debug/memory`

**Investigate**:
- Sessions not being deallocated
- Usage records accumulating
- Cache not expiring

---

## Success Criteria

✅ **All 12 scenarios pass**
✅ **Performance benchmarks met**
✅ **No memory leaks detected**
✅ **Zero security vulnerabilities**
✅ **Logs clean during normal operation**

**QA Sign-off Required**: After all scenarios validated by human QA team.
