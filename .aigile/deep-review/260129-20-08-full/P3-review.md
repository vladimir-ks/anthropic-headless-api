# Review: P3 Auth Pool - Core

## Critical Issues

**allocation-balancer.ts:20** - Missing constructor parameter validation. PoolConfig not null-checked, can crash during instantiation if undefined passed.

**usage-tracker.ts:262** - Integer parsing without radix parameter. `parseInt(parts[2], 10)` is correct but pattern is fragile - key splitting by `:` assumes exact format. Malformed keys could cause NaN timestamp values, bypassing usage queries.

**usage-tracker.ts:282** - Unsafe date parsing. `new Date(blockId).getTime()` assumes blockId is ISO string. If blockId format changes, will return NaN, breaking block boundary calculations.

**health-calculator.ts:20** - Constructor requires PoolConfig but not validated. If undefined, all property accesses will crash. No fallback for missing config.

**session-store.ts:23** - Unbounded memory cache. Map grows indefinitely with no eviction policy. Long-running servers will leak memory. No cache size limit or TTL mechanism.

**subscription-manager.ts:16** - Same unbounded cache issue. No memory limits on cache Map.

## Important Issues

**allocation-balancer.ts:104-112** - Race condition in session allocation. Between `getSubscription()` call and `updateSubscription()`, another thread could modify subscription state. Assignment list could have duplicates or be stale.

**usage-tracker.ts:85** - Fire-and-forget update. `updateSubscriptionFromUsage()` not awaited, errors silently swallowed. Subscription state may not sync with usage record.

**usage-tracker.ts:254-270** - O(n) query performance. `getUsageRecordsSince()` lists all keys and loops through them. With millions of records, this becomes very slow. No batch operations or indexed queries.

**notification-manager.ts:139** - Unhandled fetch errors silently fail. No timeout, no retry logic. Webhook might hang indefinitely.

**health-calculator.ts:19** - Hardcoded $25 expected block cost. Should be configurable, not magic number. Different subscription tiers need different expectations.

**session-store.ts:197-200** - Inefficient iteration for stale marking. Lists all sessions, loads each one. No indexed queries by lastActivity. O(n) operation on every stale check.

**allocation-balancer.ts:149-155** - Subscriptions sorted by currentBlockCost but cost could be null/undefined in edge cases (new subscriptions). No null coalescing.

## Gaps

**usage-tracker.ts** - Missing validation of token counts. Negative or fractional token values accepted without validation. Could corrupt burn rate calculations.

**allocation-balancer.ts:107** - No deduplication when adding clients to assignedClients array. If same clientId allocated twice, array has duplicates.

**notification-manager.ts** - No rate limiting on notifications. Same threshold crossed repeatedly triggers duplicate webhooks without backoff.

**subscription-manager.ts:136-141** - Shutdown doesn't flush pending cache writes. If cache has dirty entries, they're lost.

**health-calculator.ts** - No handling of edge case where weeklyBudget is 0. Division by zero possible in line 30.

**session-store.ts** - No cleanup for cache entries when sessions deleted from storage. Cache and storage can diverge on delete.

**usage-tracker.ts** - No idempotency. Recording same usage twice creates duplicate records (no dedup key).

**allocation-balancer.ts:236** - Deallocate is no-op if session not found. Should probably warn or error if client expects to be deallocated.

## Summary

Core modules have critical memory leaks (unbounded caches), unsafe parsing (blockId conversion), race conditions (concurrent allocation updates), and silent failures (fire-and-forget updates). Health calculator has division-by-zero vulnerability. Session management lacks deduplication safeguards. Notification system has no backpressure. Performance degrades linearly with record count due to missing indexed queries.

Security: Low risk from injection (all data from structured sources). Storage access properly scoped. Main risks are DoS (unbounded cache, slow queries) and data corruption (duplicates, stale reads).

## Fixes Immediately Applied

None. Await confirmation before applying fixes. Issues require design decisions:

- Cache strategy: LRU? TTL? Configurable limits?
- Parsing safety: Stricter key format validation? Schema enforcement?
- Race conditions: Use distributed locks? Atomic transactions?
- Performance: Add indexes? Use batch queries?
- Config defaults: What are safe fallback values?
