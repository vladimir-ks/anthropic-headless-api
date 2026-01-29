# Review: P6 Test Coverage

## Critical Issues

**validation.test.ts:148-154** - Tool validation incomplete. Tests accept tools array but schema may not validate individual tool names against allowed_tools list. Lacks tests for invalid tool names rejection.

**session-continuity.test.ts:435-437** - Race condition in concurrent allocation test. Code calls `sessionStore.getSession()` without await but treats as sync call, will return Promise instead of session data, breaking test assertions.

**security.test.ts:105-116** - JSON injection tests incomplete. Tests check for common patterns (command substitution, backticks) but miss other injection vectors: template literals with interpolation, prototype pollution attempts, circular reference attacks.

**api.test.ts:40-58** - Session ID validation incomplete. Manual UUID regex check doesn't match Zod schema validation. Missing tests for UUID versions, nil UUID edge cases (00000000-0000-0000-0000-000000000000).

## Important Issues

**Missing test coverage for core modules:**
- Router.ts (routing logic, fallback decision, cost estimation) - zero test coverage
- BackendRegistry.ts (backend instantiation, configuration loading) - zero test coverage
- SQLiteLogger.ts (database operations, migrations, logging) - zero test coverage
- ProcessPool/ClaudeProcessPool (queue management, concurrent execution limits) - zero test coverage
- AuthPoolIntegration.ts (pool initialization, configuration validation) - zero test coverage
- All backend adapters (AnthropicAPI, OpenRouter, OpenAI, Gemini, ClaudeCLI) - zero test coverage
- Context reader (path security, file reading) - security tests exist but insufficient coverage for error paths

**Missing edge case tests:**
- api.test.ts lacks tests for: concurrent requests, request timeouts, malformed UTF-8 in body
- validation.test.ts lacks boundary tests: max_tokens at limits, max message array size
- rate-limiter.test.ts lacks: distributed client tracking edge cases, clock skew scenarios
- session-continuity.test.ts requires running server (integration only), no unit tests for session state logic

**Resource management gaps:**
- No tests verify database connection cleanup in SQLiteLogger
- No tests verify process pool queue cleanup on errors
- No tests verify stream cleanup in streaming responses
- Rate limiter interval cleanup (afterEach calls stop()) but no tests for memory leaks with many rate limiters

## Gaps

1. **Backend adapter testing** - No tests for error handling paths in adapters (network errors, invalid responses, rate limits). Cost estimation not validated.

2. **Config validation** - BackendRegistry loads JSON without schema validation. No tests for malformed JSON, missing required fields, or invalid provider types.

3. **Streaming response handling** - session-continuity.test.ts checks stream structure but doesn't test: error handling mid-stream, connection drops, incomplete chunks.

4. **Database schema** - SQLiteLogger runMigrations() assumes migration file exists. No tests verify: migration idempotence, schema correctness, or recovery from partial migrations.

5. **Error recovery** - Most tests expect success paths. Missing tests for: recovery after transient errors, retry logic, circuit breaker patterns.

6. **Performance bounds** - No tests validate: max request size enforcement (413 tested in session-continuity but not in main api.test), queue wait times, rate limiter accuracy under load.

7. **Permission validation** - permission_mode field validated in schemas but no tests verify actual enforcement in routing or execution logic.

8. **Tool access control** - allowed_tools parameter validated but not tested against actual tool availability or access restrictions.

## Summary

Test suite covers primary happy paths (validation, rate limiting, session continuity) but has critical coverage gaps in routing, backend management, database operations, and resource cleanup. Session ID validation inconsistent between API test and validation test. Concurrent operation test has race condition. Router, BackendRegistry, SQLiteLogger, ProcessPool, and all adapters untested. Integration tests require live server; no unit test counterparts for session state logic. Security validation incomplete for JSON injection vectors. Config loading unvalidated.

## Fixes Immediately Applied

None - Review completed without applying fixes per protocol. Fixes require separate implementation phase with testing verification.
