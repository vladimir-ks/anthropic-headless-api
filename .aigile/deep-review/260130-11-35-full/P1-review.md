# Review: P1 Core Infrastructure

## Critical Issues

1. **index.ts:46** - Integer overflow risk: `parseInt(process.env.PORT || '3456', 10)` lacks bounds validation. PORT could parse to invalid values (0, 65536+, negative). Port must be 1-65535.

2. **sqlite-logger.ts:66** - Unhandled path traversal in migration loading: `resolve(__dirname, '../../migrations/001_create_requests_table.sql')`. Relative path construction without validation. If `__dirname` is symlinked/manipulated, migration could load from unintended location.

3. **backend-registry.ts:32-33** - Unchecked file access: `readFileSync(resolve(configPath), 'utf-8')` accepts external configPath without validation. Attacker can read any file on system via directory traversal (../../etc/passwd).

4. **router.ts:261-264** - Token estimation algorithm prone to underestimation: Dividing char count by 4 is rough approximation. Long context requests could exceed backend limits silently, causing failures. No bounds checking against max_tokens.

5. **process-pool.ts:125-130** - Fire-and-forget promise: `executeImmediate()` called without await in processNext(). If backend.execute() rejects, rejection handlers fire asynchronously. Race condition: activeCount decrements before promise settles, allowing activeCount to go negative.

## Important Issues

1. **index.ts:287-296** - Validation errors exposed to client: `formatValidationErrors()` output sent directly in error response. If function reveals schema internals, attacker learns request validation rules for exploitation.

2. **index.ts:46, 54** - Missing environment variable type coercion safety: `parseInt(..., 10)` returns NaN if env var is non-numeric. NaN comparisons fail silently (NaN < 65535 is false). Server binds to port NaN (falls to default behavior, undefined state).

3. **sqlite-logger.ts:160** - Unbounded prompt logging: `JSON.stringify(entry.metadata)` logs request messages without truncation. Large prompts (MB+ token contexts) bloat database indefinitely, enabling disk exhaustion DoS.

4. **router.ts:220-224** - Unsafe string matching for model selection: `modelLower.includes('gemini')` and `modelLower.includes('sonnet')` are substring searches. Request model="my-gemini-fake-model" incorrectly routes to real Gemini backend.

5. **router.ts:217** - Token estimation never used for capacity checks: `estimateTokens()` calculates count but router only checks pool capacity, not backend token limits. Request with 2M tokens could be routed to 128K-limit backend.

6. **index.ts:263** - UUID regex validation incomplete: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` doesn't validate UUID version. Any RFC4122-format string accepted (including nil UUID 00000000-0000-0000-0000-000000000000).

7. **process-pool.ts:183** - Console.log in production code: `console.log('[ProcessPool]...')` should use structured logger. Bypasses log level controls, pollutes stdout.

8. **backend-registry.ts:40, 42-45** - Console.log in production code: Inconsistent logging. Should use structured logger from config.

## Gaps

1. **No input sanitization on content-length header**: index.ts:230 parses Content-Length but doesn't validate against negative/float values before type conversion. `parseInt('-100', 10)` succeeds, creating logic errors.

2. **Missing timeout on router.route() and router.execute()**: No timeout configured. Hung backends block indefinitely. Should have configurable timeouts (default 30s) with graceful degradation.

3. **No rate limit bypass for health/metrics endpoints**: index.ts:148-166 health/queue endpoints bypass rate limit (intended). But no pagination on query responses. Attacker hammering /queue/status with 1000 backends causes uncontrolled computation.

4. **SQLite database not locked/exclusive mode**: sqlite-logger.ts creates Database without timeout/busy_timeout. Concurrent writes from multiple process pool threads could cause "database is locked" errors with no retry logic.

5. **No graceful degradation if SQLite logger fails**: index.ts:346 doesn't handle sqliteLogger.log() promise rejection. If database fills or locks, logging failure silently swallows errors, hiding system state.

6. **Missing authentication on admin endpoints**: /queue/status endpoint (index.ts:160) exposes internal metrics (process pool stats, backend load) without auth. Enables reconnaissance attack mapping infrastructure.

7. **Session ID validation missing in router**: Router accepts any session_id in request without validating it came from authenticated source. Session hijacking possible if client-provided IDs aren't cryptographically unique.

8. **No maximum message count validation**: router.ts doesn't validate request.messages array length. Large message arrays (10k+) could cause CPU exhaustion in token estimation loop.

9. **Process pool queue backpressure missing**: process-pool.ts throws error when queue full (line 65) but no instrumentation for monitoring queue pressure. No metrics for queue depth trends.

10. **Backend error responses not normalized**: Different backends return different error formats. Error propagation (router.ts:102-106, index.ts:323) may leak backend-specific error details to client.

## Summary

Core infrastructure has solid architecture (process pooling, intelligent routing, multi-backend support) but lacks production hardening. 5 critical vulnerabilities: unchecked file path inputs (backend config, migration SQL), unsafe integer parsing (PORT), race condition in process pool queue processing, and token estimation not enforced against backend limits. 8 important issues around validation, logging, and unsafe string matching for routing decisions. 10 design gaps in timeouts, database concurrency, admin endpoint auth, and session validation. Path traversal, environmental variable parsing, and queue race conditions require immediate fixes before production deployment.

## Fixes Immediately Applied

None. Review only - no fixes applied per instructions.
