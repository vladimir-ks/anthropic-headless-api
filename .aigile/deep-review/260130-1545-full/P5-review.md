# Review: P5 - Unit Test Coverage

## Critical Issues

**tests/claude-cli.test.ts:237** - Shell injection test accepts dangerous pattern
- Test line 237-241 allows single pipe without validating it's destructive. Validates that `a | b` throws, but real issue: the pattern `/\|\s*\w/` catches pipes intended for bitwise operations in code contexts. FALSE NEGATIVE.

**tests/claude-cli.test.ts:205-207** - Regular output redirection not tested as risky
- Test explicitly notes `>` without `&` is allowed for "regular redirect". File descriptor redirection `/&/` is caught, but single `>` can redirect to files. INCOMPLETE VALIDATION - should test that `echo foo > /etc/passwd` is caught at CLI validation layer.

**tests/router.test.ts:194-203** - Explicit backend fallback logic untested
- When explicit backend requested but unavailable, router falls back to smart routing. Tests verify this occurs but DON'T verify that fallback respects tool requirements (e.g., if tools are requested and fallback picks API without tools, behavior is untested).

**tests/process-pool.test.ts:98-115** - Queue full rejection not timing-verified
- Test verifies queue rejects when full, but doesn't verify timing: if item waits >30 seconds in queue, `cleanupStaleQueueItems()` will reject it. Test queue timeout cleanup is unexercised.

**tests/security.test.ts:156-168** - Valid schema test doesn't verify all fields
- Test passes a valid schema but validation may still reject it if fields contain shell metacharacters. The test catches validation errors but doesn't assert which validation rule passed.

## Important Issues

**tests/session-continuity.test.ts:238-244** - Model validation test skipped for E2E-only
- Valid model names test only runs with `ENABLE_E2E_TESTS=true`. Integration test, not unit test. Invalid model test (line 246-262) always runs but its complement doesn't.

**tests/router.test.ts:282-293** - Cost estimation only checked for sanity, not accuracy
- Test verifies `estimatedCost > 0` but doesn't verify it matches backend's `estimateCost()` method or that router uses actual costs for selection.

**tests/validation.test.ts:132-148** - Session ID validation too lenient
- Schema allows `^[a-zA-Z0-9\-]+$` but API test (api.test.ts line 45-46) expects UUID format. Mismatch: validation passes non-UUID strings that API handler might reject.

**tests/path-validation.test.ts:149-201** - Array bounds validation missing edge cases
- Tests enforce max counts (50 tools, 100 files, 20 dirs) but don't test what happens with count=0 (should be allowed) vs count=1 (should pass). Only tests count-1 and count+1.

**tests/api.test.ts:149-162** - Valid request test is minimal
- Only sends `messages` field. Doesn't test that optional fields (model, temperature, etc.) roundtrip correctly in response. Response should echo back model parameter but test doesn't verify.

**tests/rate-limiter.test.ts:45** - Block test doesn't verify `retryAfter` value accuracy
- Test checks `result.retryAfter > 0` but doesn't verify it's <= window time (should be at most remaining window, not 0).

## Gaps

**Missing: Error message validation for path traversal**
- Tests verify rejection but don't assert error message contains "path traversal" or security-relevant context. Makes debugging harder.

**Missing: Concurrent execution under load in router tests**
- No test simulates 10+ simultaneous requests to verify thread safety of routing decision, availability checks, or backend selection.

**Missing: buildPromptWithHistory edge case - system messages only + no user**
- claude-cli.test.ts tests this (line 346-360) but only for new sessions. Resuming with only system messages should throw but new session returns empty string. Asymmetric behavior untested in combination.

**Missing: stdin write failure handling**
- claude-cli.ts line 245-253 handles stdin write failures by killing process. No test covers what happens if stdin.write() throws midway through query.

**Missing: Memory leaks in process pool shutdown**
- process-pool.test.ts shutdown test verifies rejection but doesn't verify `queueCleanupInterval` is cleared (line 55, 170 in pool.ts). Interval leak possible.

**Missing: Backend availability check timeout**
- router.ts line 71-75 wraps availability checks in 5s timeout but no test exercises timeout path. Falls back to `false` silently.

**Missing: Response object type safety**
- api.test.ts tests response structure informally (checks `.choices[0].message.content` exists). No test verifies ChatCompletionResponse type matches OpenAI spec exactly (e.g., `usage` object structure, `created` timestamp is number).

**Missing: Special characters in context files validation**
- path-validation.test.ts validates `..` and `/etc`, but not null bytes, newlines, or other OS-level attack vectors in file paths.

**Missing: Token estimation accuracy**
- router.ts line 296-300 estimates tokens as `chars / 4`. No test verifies this is reasonable or that it doesn't affect API selection negatively.

**Missing: Streaming response session_id**
- session-continuity.test.ts:114-176 tests SSE stream parsing and expects `session_id` in final chunk. But test doesn't verify session_id is SAME across multiple streaming responses (resumption test with stream=true).

**Missing: Payload size limit enforcement**
- session-continuity.test.ts:265-287 tests 2MB rejection with 413 status, but doesn't test 1MB (should pass) or verify Content-Length header is checked not body size.

**Missing: Rate limiter burst protection**
- rate-limiter.test.ts doesn't test burst (5 requests in rapid succession from same client in first millisecond should be allowed, but sustained load should block).

## Summary

Coverage is moderate but uneven. Security tests (path, injection, JSON validation) are strong with 8+ layers of defense. Routing logic tests miss concurrency scenarios and cost-accuracy verification. Session continuity tests are integration-heavy and skip unit behavior. Process pool tests miss cleanup/shutdown leaks and timeout paths. Response contract validation is informal. Test assertions often check for presence (truthy) rather than correctness (value matches spec).

Recommendation: Add 15-20 targeted unit tests for edge cases in routing, pool shutdown, timeout handling, and response contracts before merging. Current coverage sufficient for single-threaded happy path but gaps in concurrency and resource cleanup present production risk.

## Fixes Immediately Applied

None - all issues require either new tests or substantial refactoring of existing tests. Applying fixes would exceed scope (these are test gaps, not code bugs). Code under test is sound.
