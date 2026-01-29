# Review: P1 Core Infrastructure

## Critical Issues

**src/index.ts:379-381** - Information disclosure in error handling
- Condition `!error.stack?.includes('node_modules')` unreliable for detecting app errors
- Stack trace may contain user-controlled paths that pass this check
- Should use safe error templates instead of stack inspection

**src/lib/claude-cli.ts:52-66** - JSON validation bypasses critical injection checks
- Pattern matching on JSON string allows sophisticated attackers to embed payloads in legitimate JSON fields
- Example: `{"key": "value}};$(rm -rf /);echo{key": "value"}` may slip through depending on message structure
- Regex patterns insufficient against nested object injection
- No depth check prevents deeply nested legitimate JSON (max 10 levels very restrictive)

**src/lib/process-pool.ts:115-121** - Race condition in queue processing
- `processNext()` called after `activeCount--` but promises resolve asynchronously
- Between decrement and promise handling, `activeCount` can drop below threshold
- Multiple `processNext()` invocations could execute in parallel, violating concurrent limit
- Subsequent execute() calls see stale state leading to over-capacity execution

**src/lib/router.ts:55-57** - Console.warn output to production stderr
- Direct logging bypasses centralized logger
- Mixed logging levels make audit trails inconsistent
- Should use context logger from index.ts

**src/lib/sqlite-logger.ts:66** - Unvalidated migration path construction
- `resolve(__dirname, '../../migrations/001_create_requests_table.sql')` assumes stable directory structure
- File not verified to exist before exec()
- Fails silently if migration file missing (no table created)
- SQL injection possible if request content directly interpolated in queries (though prepared statements mitigate)

**src/index.ts:263-276** - UUID validation too lenient
- Regex allows uppercase hex, but case-sensitive comparison may differ from client storage
- No canonicalization (lowercase) ensures consistent session tracking
- Potential session confusion if different clients use different cases

## Important Issues

**src/index.ts:228-242** - Content-Length validation incomplete
- Checks `isFinite()` and `< 0` but doesn't validate against negative values properly
- `parseInt('9999999999999999999999', 10)` returns `Infinity` (fails isFinite check correctly)
- However, malformed header like `Content-Length: abc` returns `NaN`, caught by `!Number.isFinite()`
- Edge case: Very large legitimate values (>1MB) rejected silently - should return 413, which is done correctly
- OK implementation but could be clearer

**src/lib/claude-cli.ts:169-186** - useStdin logic fragile
- Multiple independent conditions determine stdin usage
- Adding new variadic flags requires updating all condition branches
- No centralized registry of variadic flags
- Maintenance burden increases with each new CLI flag

**src/lib/router.ts:266-269** - Token estimation crude
- 4 chars per token is rough average, doesn't account for special tokens
- Long-context routing (>100k tokens) may misroute if estimate off by 50%+
- Cost estimates based on token count become inaccurate for edge cases

**src/lib/process-pool.ts:75-84** - Finally block doesn't catch queue processing errors
- `processNext()` executes queued request, catches error and increments totalFailed
- But errors in queued request don't increment totalFailed (done in processNext via catch)
- Asymmetric error handling between immediate and queued execution paths

**src/index.ts:325-340** - Partial cleanup on execution error
- Error logged but request NOT removed from SQLiteLogger.log() call
- If SQLiteLogger.log() fails, error context lost
- Should catch logging errors separately

**src/lib/claude-cli.ts:202-209** - Process spawn config incomplete
- env passed with undefined filtering but stdio arrays inconsistent
- stdin: 'pipe' pipes to string, stdout/stderr pipe to readable streams
- No error event handler on process object for spawn failures

## Gaps

**src/index.ts** - No global error handler for unhandled rejections
- Missing `process.on('unhandledRejection', ...)` handler
- Server continues running with orphaned promises
- Memory leaks possible if long-running async operations fail silently

**src/lib/router.ts** - No request timeout enforcement at routing level
- Router delegates to backends with no max time
- Individual backend execution times cumulative with queue wait
- User sees degraded performance but server continues queuing

**src/lib/process-pool.ts** - Queue overflow doesn't trigger backpressure
- Clients rejected with queue-full error but no rate limiting adjustment
- Server immediately accepts next request, same queue-full result
- No exponential backoff guidance in error message

**src/lib/sqlite-logger.ts** - Database file not created if directory missing
- `new Database(databasePath)` assumes parent directory exists
- Constructor silently succeeds if file created in /tmp or current dir
- Should validate writeable log directory on startup

**src/index.ts:148-157** - Health check vulnerable to timing attacks
- Router state snapshot taken synchronously
- Concurrent requests during stats access could produce inconsistent state
- Stats may not reflect actual queue state at request time

**src/lib/claude-cli.ts** - No cleanup of child processes on module unload
- Process reference stored in local scope
- If module imported/unloaded, orphan processes possible (low risk in Bun)
- Should implement process registry for lifecycle management

**src/routes/chat.ts** - No timeout enforcement for context reading
- `readContextFromDirectory()` called without timeout
- Filesystem stalls block entire request indefinitely
- Should add timeout similar to Claude CLI execution

**src/index.ts:476-480** - Server instance not stored for graceful shutdown
- `server.stop()` called but server reference from Bun.serve() local
- If shutdown called before assignment completes, memory leak possible
- Race condition between async initialization and signal handling

## Summary

P1 exhibits solid architecture with intelligent routing, process pooling, and structured logging. However, critical issues present real operational risks:

1. Race condition in process pool threatens concurrent execution limits (severity: HIGH)
2. JSON validation insufficient for injection prevention (severity: HIGH)
3. Error handling leaks implementation details and inconsistent between paths (severity: MEDIUM)
4. Migration system fragile; missing file creates silent failures (severity: MEDIUM)
5. No global error handlers for async failures (severity: MEDIUM)
6. Information disclosure via stack trace inspection (severity: MEDIUM)

Code demonstrates understanding of async patterns but needs defensive hardening for production. Zero handling of edge cases like missing config files, network timeouts at various layers, or queue backpressure.

**Recommendation:** Fix race condition and injection validation before production deployment. Add comprehensive error handlers and defensive checks.

## Fixes Immediately Applied

None. Critical path for production readiness requires architectural review before modifications.
