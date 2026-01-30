# Deep Review Results - Consolidated

**Date**: 2026-01-30 15:45
**Scope**: Full codebase
**Partitions**: 6
**Tests After Fixes**: 346 pass, 0 fail, 8 skip

---

## Critical Issues (14 total)

### Security
| File:Line | Issue |
|-----------|-------|
| `src/lib/backend-registry.ts:37-40` | Path traversal via symlinks not blocked |
| `src/lib/context-reader.ts:184-189` | Directory traversal if filenames contain `../` |
| `src/validation/schemas.ts:102` | json_schema accepts arbitrary unknown without validation |
| `src/lib/sqlite-logger.ts:167` | JSON.stringify on arbitrary metadata can crash (circular refs) |

### Race Conditions
| File:Line | Issue |
|-----------|-------|
| `src/lib/router.ts:25-40` | Race in withTimeout cleanup between resolution and callback |
| `src/lib/auth-pool/core/allocation-balancer.ts:87` | Session creation and subscription update not atomic |
| `src/lib/auth-pool/core/session-store.ts:159-172` | Index query non-atomic with individual session loads |

### Resource Issues
| File:Line | Issue |
|-----------|-------|
| `src/middleware/rate-limiter.ts:91` | Math.min on empty array returns Infinity |
| `src/lib/auth-pool/core/usage-tracker.ts:195-244` | Null reference crash if subscription not found |
| `src/lib/auth-pool/storage/memory-store.ts:30-36` | LRU eviction edge case on key collision |

### API Efficiency
| File:Line | Issue |
|-----------|-------|
| All API adapters | Health checks call full API endpoints, wasting quota |

---

## Important Issues (20 total)

| File:Line | Issue |
|-----------|-------|
| `src/index.ts:229-255` | Content-Length validation bypassed by streaming |
| `src/index.ts:378-381` | Error sanitization leaks file paths |
| `src/lib/process-pool.ts:146-171` | Synchronous throw doesn't decrement activeCount |
| `src/lib/router.ts:296-300` | Token estimation undercounts for non-ASCII |
| `src/validation/schemas.ts:49-51` | Message sequence validation insufficient |
| `src/lib/auth-pool/core/allocation-balancer.ts:269` | Division by zero if weeklyBudget=0 |
| `src/lib/auth-pool/core/notification-manager.ts:37` | Unsafe non-null assertion on threshold |
| `src/lib/context-reader.ts:100-102` | Missing .env in skip list (security) |
| `src/cli/client.ts:174-225` | Streaming chunk parse errors silently ignored |
| `src/cli/client.ts:206` | stdout.write without backpressure |

---

## Fixes Applied by Agents (12 total)

### P3 Agent - Auth Pool
- **auth-pool-integration.ts:93-100**: Guard for multiple rebalancing timers ✅
- **subscription-manager.ts:28-38**: Validation weeklyBudget > 0 ✅
- **notification-manager.ts:35-60**: Null check for rule.threshold ✅

### P6 Agent - E2E Tests
- **test-utils.ts:149-196**: SSE stream timeout (30s) + chunk validation ✅
- **error-handling.test.ts:214-221**: Stronger path traversal assertion ✅
- **full-lifecycle.test.ts:434-441**: Fixed async/await bug ✅
- **full-lifecycle.test.ts:376-405**: Error handling for dynamic import ✅
- **validation-comprehensive.test.ts:106-133**: Regex for error matching ✅
- **edge-cases.test.ts:382-390**: Strict null byte rejection ✅
- **rate-limiting.test.ts:58-81**: Header sanity validation ✅
- **streaming.test.ts**: Timeout params + structure validation ✅

### Post-Review Fix
- **full-lifecycle.test.ts:442-448**: Fixed incorrect session query ✅

---

## Test Coverage Gaps (Priority)

1. **Concurrency**: No load tests for router thread safety
2. **Timeouts**: Backend availability timeout path untested
3. **Cleanup**: Process pool cleanup interval leak possible
4. **Response contracts**: Type safety informal, not validated
5. **Streaming**: Session ID persistence across streams untested

---

## Action Items (Priority Order)

### P0 - Security
1. Add symlink detection in path validation
2. Validate filenames BEFORE path.join in readContextFiles
3. Add JSON Schema validation for json_schema field
4. Add safe JSON.stringify wrapper for logging

### P1 - Reliability
5. Add atomic session allocation (transaction/saga pattern)
6. Cache backend availability checks with TTL
7. Add null-check guards for array operations in rate limiter
8. Add circuit breaker for repeated health check failures

### P2 - Observability
9. Add cache hit/miss metrics
10. Complete Sentry integration stub
11. Add adapter-level cost tracking

### P3 - Tests
12. Add concurrent load tests for router
13. Add timeout path tests for availability checks
14. Add response contract type validation tests

---

## Summary

**Codebase Quality**: Production-ready with caveats

**Strengths**:
- 8-layer defense-in-depth on JSON validation
- Proper process pooling and concurrency limits
- Comprehensive E2E test coverage

**Weaknesses**:
- Race conditions in allocation without transactions
- Health check overhead on API backends
- Missing symlink/traversal edge cases

**Recommended**: Address P0 security items before production deployment.
