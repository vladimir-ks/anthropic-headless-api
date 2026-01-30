# Review: P3 Auth Pool Core

## Critical Issues

1. **allocation-balancer.ts:20** - Constructor missing PoolConfig parameter in HealthCalculator instantiation. `new HealthCalculator()` should receive `config` parameter (HealthCalculator requires PoolConfig in constructor).

2. **health-calculator.ts:20** - Constructor declares `config` parameter with type `PoolConfig` but is never used anywhere in the class. Creates dead code path and constructor signature mismatch.

3. **usage-tracker.ts:262** - Array parsing vulnerability in `getUsageRecordsSince()`. `parseInt(parts[2], 10)` assumes exactly 3 colon-separated parts. Malformed key format (e.g., `usage:sub:id:with:colons:1738070000000`) causes wrong index access and silently fails validation.

4. **allocation-balancer.ts:107** - Array mutation antipattern. Spreads `assignedClients` then immediately persists, bypassing session store existence checks. Race condition: session created in store but subscription update could reference non-existent session simultaneously.

5. **session-store.ts:260-267** - Cache eviction uses brittle insertion order (FIFO). No timestamp tracking. Cannot distinguish between old cached entry (stale) and new entry (fresh). Evicts recently used sessions instead of truly stale ones.

## Important Issues

1. **subscription-manager.ts:97-115** - `updateSubscription()` performs read-then-update without transaction atomicity. Between `getSubscription()` and `storage.set()`, another process could modify state. Subscription state corruption possible.

2. **allocation-balancer.ts:65-70** - Sorting mutates original subscription array in-place. `available.sort()` modifies the filtered array reference. Side effects on caller's potential assumptions about non-mutation.

3. **usage-tracker.ts:56** - `getActiveBlockId(timestamp)` delegates to utility but doesn't validate timestamp parameter exists. `getActiveBlockId()` fallback to current time masks potential upstream bugs where invalid timestamps propagate silently.

4. **session-store.ts:83-97** - Cache consistency bug. `getSession()` loads from storage but doesn't validate against schema. Retrieved stale data passes through without re-validation, corrupting downstream health calculations.

5. **allocation-balancer.ts:168-169** - Index-based filtering on potentially unsorted sessions. `idleSessions.filter()` trusts array indexing after `getSessionsBySubscription()` with no guarantee of order stability. Rebalancing selects wrong clients under concurrent modifications.

6. **health-calculator.ts:130** - Division by zero potential. `calculateBlockPercentage()` divides by `EXPECTED_BLOCK_COST`. If subscription has `currentBlockCost` but calculation is off, returns `Infinity` or `NaN` without clamping check before division.

## Gaps

1. **Missing error recovery** - No circuit breaker in `allocation-balancer.rebalance()`. If session reassignment fails for one client, entire rebalancing stops mid-operation. State left inconsistent (some clients moved, some not).

2. **No transaction boundaries** - Multiple storage calls lack atomic guarantees. `allocateSession()` creates session then updates subscription in separate calls. Failure between calls leaves orphaned session.

3. **Undefined config in HealthCalculator** - Constructor accepts unused `config` parameter. No validation that PoolConfig fields (rebalancing thresholds, etc.) match Health Calculator constants. Configuration misalignment possible.

4. **Missing storage close() calls** - Only `subscription-manager.shutdown()` closes storage. `session-store`, `usage-tracker`, `allocation-balancer` never invoke `storage.close()`. Resource leaks in file handles or connections.

5. **No session expiration logic** - `markStale()` is public but never called from framework. Sessions marked idle indefinitely. No automatic cleanup triggering stale session removal.

6. **Cache invalidation missing** - Subscription cache in `subscription-manager` and session cache in `session-store` can diverge from storage without explicit invalidation mechanism. No refresh or TTL-based eviction.

7. **Insufficient index validation** - `getSessionsBySubscription()` returns sessions from index without verifying they still exist in storage. Orphaned index entries return null, polluting results.

## Summary

Auth Pool Core has **solid foundational architecture** (clean separation of concerns, schema validation, caching patterns) but exhibits **critical concurrency and transaction safety gaps**. Constructor parameter mismatch in HealthCalculator will cause immediate runtime failure. Array parsing vulnerability enables state corruption via malformed keys. Most severe: lack of atomic transactions across storage operations enables race conditions where clients become orphaned or allocated to non-existent subscriptions. Cache eviction uses insertion order rather than LRU, degrading performance. No resource cleanup paths for storage connections. Code is defensive in validation but lacks defensive design in state consistency.

**Deployability: MEDIUM RISK** - Will function in single-threaded environment but unsafe under concurrent load. Requires transaction wrapping and storage close() integration before production.

## Fixes Immediately Applied

None - This is a read-only review. Identified issues require architectural fixes:
- Add PoolConfig parameter to HealthCalculator constructor call
- Implement transaction atomicity for multi-step operations (allocateSession, reassignSession)
- Replace FIFO cache eviction with LRU or timestamp-based TTL
- Add storage.close() lifecycle integration to all managers
- Add robust key parsing with validation in getUsageRecordsSince()
- Implement circuit breaker pattern in rebalance() error handling
