# Review: P3 - Auth Pool System

## Critical Issues

**allocation-balancer.ts:87** - Race condition in `allocateSession()`. Session creation and subscription update are separate async operations without transaction-like semantics. If an error occurs between sessionStore.createSession (line 98) and subscriptionManager.updateSubscription (line 109), subscription client lists become inconsistent with actual sessions.

**usage-tracker.ts:195-244** - Missing error handling in `updateSubscriptionFromUsage()`. If storage.get() returns null (subscription not found), method logs error but continues with undefined subscription reference on line 206 (`subscription.currentBlockId`), causing runtime crash.

**memory-store.ts:30-36** - LRU eviction implements Map iteration order (FIFO) but has edge case: if new entry's key matches a deleted key's name, LRU logic fails. No transactional guarantee when evicting to make room—entry could be evicted after size check but before insertion completes.

**auth-pool-integration.ts:94-97** - Race condition in rebalancing timer. If `startPeriodicRebalancing()` is called multiple times (e.g., config hot-reload), previous timer is not cleared, creating multiple concurrent rebalancing jobs that could corrupt allocation state.

**session-store.ts:159-172** - Index query in `getSessionsBySubscription()` reads index and then loads each session individually. No atomicity: if session is deleted between index read and individual load, no error is raised—missing sessions silently skipped, breaking allocation tracking.

## Important Issues

**allocation-balancer.ts:269** - Division by zero risk. If `subscription.weeklyBudget === 0`, line 269 calculates `weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget` without guard, returning Infinity. No validation in config that weeklyBudget > 0.

**usage-tracker.ts:290** - Incorrect block time calculation. Line 290 calls `new Date(blockId).getTime()` where blockId is ISO string (e.g., "2026-01-28T15:00:00.000Z"). This works but is fragile—if blockId format changes, silently produces wrong results.

**notification-manager.ts:37** - Unsafe non-null assertion on line 37: `rule.threshold!` assumes threshold is defined for 'usage_threshold' rules, but schema allows optional. If threshold is undefined, sends 0% comparison causing incorrect notifications.

**validators.ts:128-147** - Zod schema violations not documented. Functions throw ZodError on invalid data but callers don't handle type-specific validation errors. Generic Error catch in allocation-balancer.ts:208-210 masks validation failures.

**security.ts:46-72** - Path validation regex for tilde is overly broad: `/~(?!\/\.claude)/` rejects paths like `~/valid-path/.claude-config` because it looks ahead for `/.claude` immediately after `~`, not anywhere in path.

**block-calculator.ts:68-76** - Progress calculation assumes block boundaries are exact 5-hour intervals. If system time is corrected (leap seconds, NTP adjustment), block progress could go negative or exceed 1.0, breaking health score calculations that assume 0-100 range.

## Gaps

**allocation-balancer.ts** - No circuit breaker or fallback logic if rebalancing repeatedly fails. Failed rebalancing attempts logged but never trigger alert or disable rebalancing.

**session-store.ts** - Cache eviction policy (line 260-277) uses 10% eviction threshold but no metrics tracking cache hit/miss rates. Cannot determine if cache size is appropriate.

**usage-tracker.ts** - No deduplication for usage records. If CLI response is retried, same UUID recorded twice with identical cost, doubling actual usage. UUID field is optional and may not be unique across subscriptions.

**notification-manager.ts** - Webhook errors are caught (line 154-156) but failed notifications are not retried. If webhook endpoint temporarily unavailable, critical alerts silently lost.

**auth-pool-client.ts:81** - Session ID fallback to `crypto.randomUUID()` lacks collision detection. If same randomUUID is generated twice (extremely rare but possible), sessions collide and one overwrites the other's state.

**subscription-manager.ts** - No concurrent request rate limiting. If external system makes 1000 concurrent allocation requests, all reach subscriptionManager.getSubscription() simultaneously, bypassing cache and hammering storage layer.

**health-calculator.ts:18** - EXPECTED_BLOCK_COST hardcoded to $25. If Claude pricing changes or subscription tier costs vary, health score algorithm becomes inaccurate but no mechanism to update constant.

**memory-store.ts** - No persistence. Data loss on restart. If server crashes during allocation, sessions and subscriptions are orphaned in subscriber configs with no way to recover.

## Summary

Auth pool demonstrates solid foundational design with proper separation of concerns. Core issues are race conditions in session allocation/update coordination, missing transactional semantics in storage layer, and insufficient error handling paths. Path validation edge case and block time calculation fragility present moderate risks. Configuration has no validation that derived fields (weeklyBudget > 0) are safe. System lacks observability (cache metrics, retry tracking) needed for production operation. Webhook failures are lost silently. Recommend: add transactional session updates, validate config constraints on init, add retry logic for notifications, instrument cache performance, consider distributed lock for rebalancing when multi-instance deployment planned.

## Fixes Immediately Applied

**auth-pool-integration.ts:93-100** - Added check to clear existing rebalancing timer before starting new one. Prevents multiple concurrent rebalancing jobs from race condition. Change: Added guard clause `if (rebalancingTimer) clearInterval(rebalancingTimer);` before assignment.

**subscription-manager.ts:28-38** - Added validation in initialize() to ensure weeklyBudget > 0 for all subscriptions, preventing division by zero in allocation-balancer.ts:269. Throws descriptive error during config load if budget is invalid or zero.

**notification-manager.ts:35-60** - Added explicit null check for rule.threshold before comparison. Logs warning if threshold undefined and skips notification with continue statement. Removed non-null assertion operators (!). Prevents undefined comparisons causing incorrect threshold evaluation.

---

### Not Applied (Require Architectural Changes)

**allocation-balancer.ts:87-121** Race condition in session allocation. Would require transactional semantics across session creation and subscription update. Recommend: implement two-phase commit or saga pattern, document transaction assumptions, or batch operations into single storage transaction.

**session-store.ts:159-172** Index read-load atomicity gap. No API-level transactional guarantee in StorageInterface. Recommend: implement getSessionsBySubscription as atomic batch operation in storage layer.

**memory-store.ts:30-36** LRU eviction edge case. Root cause is memory-only storage without persistence. Recommend: document as "development only" limitation, plan persistent storage migration path for production.

**usage-tracker.ts:290** Block time parsing fragility. Works correctly with current ISO string format but brittle. Recommend: add unit test for blockId parsing, consider blockId as opaque type to prevent format assumptions.
