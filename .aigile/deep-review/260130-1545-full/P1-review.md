# Review: P1 - Core Gateway & Routing

## Critical Issues

**src/index.ts:263-276** - Weak session ID validation. UUID regex pattern is correct but validation occurs only after body JSON parsing. Should validate header before attempting to use it as trusting user input.

**src/lib/router.ts:25-40** - Race condition in `withTimeout` implementation. The `timeoutId` is captured in closure but may not be properly cleared if promise resolves before setTimeout callback. While `finally` block attempts cleanup, a race exists between resolution and timeout callback execution.

**src/lib/backend-registry.ts:37-40** - Path traversal prevention is insufficient. Blocking `/etc, /var, /usr, /bin, /sbin, /root, /proc, /sys` doesn't prevent symlink traversal attacks. An attacker could place symlinks in allowed directories pointing to sensitive files.

**src/middleware/rate-limiter.ts:91** - Unsafe array operation. `Math.min(...entry.timestamps)` on line 91 can fail silently with an empty array, returning `Infinity`. While line 85 filters timestamps, there's a theoretical race condition if cleanup happens between line 85 and 91 in concurrent execution.

## Important Issues

**src/index.ts:229-255** - Request size validation checks `Content-Length` header but doesn't validate request body size during streaming. Malicious client could send `Content-Length: 100` then stream 100MB, bypassing the limit.

**src/index.ts:378-381** - Error message sanitization is weak. Checking `!error.stack?.includes('node_modules')` is fragile. Stack traces can leak file paths, internal structure, or database connection strings in some error types.

**src/lib/process-pool.ts:146-171** - `processNext()` uses a flag to prevent reentrancy but doesn't handle case where `executeImmediate` throws before decrementing `activeCount`. This could cause permanent queue blockage if a request throws synchronously.

**src/middleware/rate-limiter.ts:91, 111** - Multiple `Math.min/max` operations on timestamp arrays. No bounds checking. If timestamps array somehow becomes empty between checks, `Math.min(...)` returns `Infinity` causing incorrect `resetAt` calculation.

**src/routes/chat.ts:32-34** - `crypto.randomUUID()` is used but not declared. Relies on global crypto object. If running in environment where crypto is not available, this will throw at runtime.

**src/lib/router.ts:296-300** - Token count estimation is simplistic (4 chars per token). For non-ASCII text, this dramatically undercounts tokens, potentially routing incorrectly to wrong backend.

**src/index.ts:346** - SQLite logger called without error handling. If logging fails, response still goes to user but request is not logged. Creates blind spot in audit trail.

## Gaps

**All files** - No input sanitization for backend names/model names. While backendRegistry checks existence, user input from URL path (line 223) or body (line 300) is passed directly to logging and decision making without validation.

**src/lib/process-pool.ts** - No maximum request size limits per process pool. Large requests could exhaust memory even with concurrency limits if multiple large requests queue.

**src/index.ts** - Missing timeout on `req.json()` parsing (line 258). Slowloris attack could cause parser to hang indefinitely on incomplete JSON.

**src/middleware/rate-limiter.ts** - No protection against timing-based attacks. Reset time calculations are based on oldest timestamp in window, allowing attacker to measure exact window boundaries.

**src/lib/router.ts:268** - Backend selection sort is mutable. If multiple backends have same cost, sort order is undefined, making routing non-deterministic. Could leak information about which backends prefer which requests over time.

**src/index.ts:140** - All debug logs include request details. In production with `LOG_LEVEL=debug`, could log sensitive headers, API keys, or request bodies.

**src/lib/backend-registry.ts:43-44** - JSON parsing has no size limit. Malicious `backends.json` with huge nested structures could cause parser to hang or consume excessive memory during startup.

## Summary

Gateway exhibits moderate security posture with path validation, rate limiting, and request validation present. Critical gaps in:
- Session validation ordering (should validate before use)
- Race conditions in async timeout handling and rate limiter state
- Path traversal via symlinks not blocked
- Error message leaking implementation details
- Request streaming bypasses content-length limits
- Missing input validation on user-controlled routing parameters

Rate limiter has subtle bugs with empty array operations and concurrent cleanup. Process pool doesn't handle premature throws. No real streaming support despite claiming to simulate it - full response loaded in memory.

Fixes should prioritize: session validation reordering, bounded arrays with null-checks, symlink detection, error sanitization, streaming timeout, and request parameter validation.

## Fixes Immediately Applied

None at this stage. Review complete and findings documented in output file. Fixes require careful consideration of fallback behavior and should be tested thoroughly with concurrent load.
