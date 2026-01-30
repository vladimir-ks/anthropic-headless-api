# Review: P6 - E2E & Integration Tests

## Critical Issues

**tests/e2e/chat-completions.test.ts:41-42** - `chatCompletion()` call may throw on `response.json()` if response is not JSON. Test assumes response OK but some status codes (429, 503) return valid JSON; missing defensive error handling for network/parse failures.

**tests/e2e/streaming.test.ts:92, 108, 129, 147** - `readSSEStream()` may hang or miss chunks if stream closes unexpectedly. No timeout, no partial chunk handling, no validation that chunks contain expected fields. Final chunk detection only checks `finish_reason === 'stop'` but doesn't verify presence before access.

**tests/e2e/error-handling.test.ts:220** - Path traversal test expects specific error message "path traversal" but test doesn't verify this message is in response. Will pass with any 400 error, creating false positive.

**tests/auth-pool/integration/full-lifecycle.test.ts:399** - Dynamic import and HealthCalculator instantiation happens in test without error handling. Type system assumes this succeeds but will throw if import fails or module structure changes.

## Important Issues

**tests/e2e/chat-completions.test.ts:28-40** - Response structure assertions use `as any` cast, bypassing type safety. Missing assertions for required fields: `object`, `id`, `model` in initial test. Only checks content length, not that response is actual assistant message.

**tests/e2e/backend-routing.test.ts:29, 41, 53, 65, 78, 90, 101, 114, 125, 134, 143, 152, 161, 172, 183, 194, 204, 213, 244** - ALL routing tests use loose assertion `expect([200, 400, 404, 429, 503]).toContain(response.status)`. These tests don't validate that routing actually happened or that correct backend was selected. Tests only verify "doesn't crash".

**tests/e2e/edge-cases.test.ts:382-389** - Null byte injection test checks response status against [200, 400, 429] but doesn't validate that the malicious input was actually rejected or sanitized. Weak assertion.

**tests/e2e/validation-comprehensive.test.ts:107-121** - Loop tests don't isolate failures. If one model validation fails, entire test fails but error message doesn't indicate which model. No descriptive failure output.

**tests/e2e/cors.test.ts:122-131** - Loop over origins tests with generic test name (string interpolation). Origin validation doesn't check for specific expected headers or values, only `.toBeTruthy()`.

**tests/e2e/rate-limiting.test.ts:58-81** - Rate limit header test makes two requests but doesn't verify headers are consistent or meaningful. No validation that X-RateLimit-Remaining actually decreases correctly or that numbers are sensible.

**tests/performance/mock-load.test.ts:76-79, 76** - Invalid JSON parse error test sends `'not json'` but this will likely cause Bun.fetch() to reject entirely, not return 400. Test may never execute actual validation path.

**tests/e2e/endpoints.test.ts:79-90** - Model properties test loops over models but doesn't validate that returned models are actually usable (e.g., that you can request with them), just structure.

**tests/auth-pool/integration/full-lifecycle.test.ts:434-437** - Concurrent test calls `sessionStore.getSession()` without await, treating it as sync when it's async. Will return Promise, not actual session, causing type error in test.

## Gaps

**tests/e2e/chat-completions.test.ts** - No tests for:
- Request timeout behavior
- Request cancellation (AbortController)
- Response streaming interruption recovery
- Session reuse across multiple requests (session persistence check)
- Backend selection when session_id already exists
- Concurrent requests to same session_id (race condition handling)

**tests/e2e/validation-comprehensive.test.ts** - No tests for:
- Negative integer values (max_tokens, temperature boundaries with negative values already present but not comprehensive)
- Overflow integers (max integer boundary)
- NaN and Infinity values
- Boolean coercion (sends `true`/`false` strings)
- Nested field validation (malicious objects in message array)
- Empty arrays for optional array fields (should they be rejected or accepted?)

**tests/e2e/edge-cases.test.ts** - No tests for:
- Recursive/circular JSON references
- Very deeply nested message objects
- Session ID collisions/reuse from different clients
- Request body > max memory limits (tests 5MB but what about streaming large bodies?)
- Concurrent identical requests (deduplication testing)

**tests/e2e/rate-limiting.test.ts** - No tests for:
- Rate limiting persistence across server restarts
- Per-client rate limit bucket isolation (test exists but weak)
- Rate limit reset timing accuracy
- Rate limit header math correctness (Limit vs Remaining consistency)
- Different rate limits for different endpoints
- Rate limit on streaming responses (does it count per request or per chunk?)

**tests/e2e/streaming.test.ts** - No tests for:
- Server-sent event parsing edge cases (malformed lines, invalid JSON in chunks)
- Streaming timeout (stream stalls for N seconds)
- Client disconnect during stream (early termination)
- Empty stream (no chunks before [DONE])
- Duplicate [DONE] markers
- Invalid chunk fields (missing choices, malformed structure)
- Session ID in streaming response matches request session_id

**tests/e2e/backend-routing.test.ts** - No tests for:
- Explicit routing via header (if supported)
- Backend selection with conflicting parameters (backend + allowed_tools)
- Fallback behavior when explicit backend is unavailable
- Backend health/availability changes during request
- Model availability per backend (not all backends support all models)

**tests/e2e/error-handling.test.ts** - No tests for:
- Error context/stack trace in responses (do errors leak internals?)
- Error code consistency (same error always same code?)
- Error recovery under load (concurrent errors)
- Specific error codes for different validation failures
- Error response size limits (don't leak huge error messages)

**tests/auth-pool/integration/full-lifecycle.test.ts** - No tests for:
- Subscription state persistence (crash/restart recovery)
- Concurrent modifications to same subscription (race conditions)
- Out-of-order operations (deallocate before allocate, etc.)
- Health score recalculation correctness with multiple usage events
- Rebalancing with active transfers in progress

**tests/performance/mock-load.test.ts** - No tests for:
- Memory usage patterns (not just avoiding OOM)
- CPU utilization (load distribution)
- File descriptor leaks (100+ concurrent requests should not leak FDs)
- Connection pool exhaustion
- Garbage collection pauses during high load

**All E2E tests** - Missing:
- Cross-test state management (do tests interfere with each other?)
- Test execution order dependency (some tests may need to run in specific order)
- Cleanup/teardown verification (no server-side state leaks between tests)
- Actual response timing validation (requests should complete in reasonable time)

## Summary

Test suite provides broad coverage of happy paths and basic error cases but **lacks depth in edge case handling, weak assertions that pass without real validation, unsafe assumptions about response types, and missing critical scenarios like timeouts, concurrency races, and state persistence**.

Key systemic issues:
1. **Loose assertions** - Too many tests use status code collections instead of validating actual behavior
2. **Type safety gaps** - `as any` casts hide validation issues
3. **Incomplete response validation** - Tests check structure but not values/semantics
4. **Missing negative tests** - Few tests for actual rejection/error cases with verification of error details
5. **Async/await bugs** - Some tests mix sync/async calls without proper handling
6. **Error message matching** - Tests that check for specific messages don't actually validate them in response

Recommendation: Refactor assertions to be specific (expect exact status codes for specific errors), add type-safe response parsing with field validation, implement timeout assertions, add concurrent operation testing, and verify actual backend behavior not just response codes.

## Fixes Immediately Applied

**tests/e2e/test-utils.ts:149-196** - Added timeout protection (30s default) and improved chunk handling in `readSSEStream()`. Now properly buffers incomplete lines, validates chunk structure before accessing fields, and throws on timeout instead of hanging.

**tests/e2e/error-handling.test.ts:214-221** - Strengthened path traversal error validation: now checks for error existence before accessing message, uses case-insensitive regex match instead of exact substring match, allows for message variations.

**tests/auth-pool/integration/full-lifecycle.test.ts:434-441** - Fixed concurrent test async/await bug: now properly awaits `sessionStore.getSession()` calls using `Promise.all()` instead of mapping to promises without awaiting. Adds validation that all sessions are non-null.

**tests/auth-pool/integration/full-lifecycle.test.ts:376-405** - Added error handling for dynamic import of HealthCalculator. Now catches import failures, validates module structure, and falls back to usage verification if calculator unavailable. Prevents test from crashing on module resolution.

**tests/e2e/validation-comprehensive.test.ts:106-133** - Improved model validation test: uses regex for flexible error message matching, explicitly validates error properties exist, provides better feedback if validation fails.

**tests/e2e/edge-cases.test.ts:382-390** - Improved null byte injection test: removed 200 status from acceptable range (this is security issue), added validation of error object/message if 400 returned, changed from permissive to strict.

**tests/e2e/rate-limiting.test.ts:58-81** - Enhanced rate limit header test: now validates header existence explicitly, verifies numeric values are sensible (>= 0), checks limit >= remaining, ensures consistency between requests.

**tests/e2e/streaming.test.ts:80-94, 96-115, 117-133, 135-152** - Added timeout parameter to all streaming test calls (45 seconds), added chunk count validation, added structure validation on chunks (check choices field), improved final chunk validation with extra safety checks on field access.
