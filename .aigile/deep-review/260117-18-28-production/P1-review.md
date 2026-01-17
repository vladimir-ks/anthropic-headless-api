# P1 Review: Core Server & Types

## Security Vulnerabilities

### 1. Header Injection via X-Session-Id (Line 236-253 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 236-253
- **Severity**: Medium
- **Category**: Security Vulnerabilities
- **Description**: UUID validation regex accepts uppercase A-F but the comparison is case-insensitive (`/i` flag). While this is technically valid UUID format, inconsistent handling could lead to session ID mismatches if the regex validation passes but subsequent code expects lowercase. The validation regex uses case-insensitive matching but UUIDs should be normalized to a single case for consistency.
- **Suggested Fix**: Normalize the validated session ID to lowercase before storing: `body.session_id = headerSessionId.toLowerCase();`

### 2. CORS Wildcard Allow-Origin (Line 98 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 96-101
- **Severity**: Medium
- **Category**: Security Vulnerabilities
- **Description**: CORS headers use `'Access-Control-Allow-Origin': '*'` which allows any origin. This is acceptable for a localhost-only service but dangerous if exposed to network. Combined with credential-based rate limiting (API keys in headers), this could enable CORS attacks. Documentation states it's for localhost only, but no enforcement at code level.
- **Suggested Fix**: Add origin validation based on environment. For production, require explicit allowed origins list or restrict to localhost when not explicitly configured.

### 3. Rate Limiting Key Extraction Weakness (Line 240-268 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 240-268
- **Severity**: Low
- **Category**: Security Vulnerabilities
- **Description**: Bearer token truncation to 20 characters (line 250) could create collisions where different tokens hash to the same rate limit key. With 20-character truncation across potentially millions of tokens, collision probability increases.
- **Suggested Fix**: Either use full token hash (crypto.subtle.digest) or increase truncation length to 32 characters minimum.

### 4. Command Injection via JSON Schema (Line 88 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 87-89
- **Severity**: High
- **Category**: Security Vulnerabilities
- **Description**: User-provided `options.jsonSchema` is passed directly to CLI via `JSON.stringify()` without validation. If the Claude CLI has shell injection vulnerabilities, malicious JSON could be crafted to exploit them. No validation of jsonSchema structure or suspicious patterns.
- **Suggested Fix**: Validate jsonSchema structure before stringifying. Ensure it conforms to JSON Schema spec and doesn't contain any suspicious patterns that could be interpreted as commands.

### 5. System Prompt Injection via User Input (Line 70-73 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 70-73
- **Severity**: Medium
- **Category**: Security Vulnerabilities
- **Description**: User can override system prompt via `system` field in request body without any restrictions or warnings. This breaks the intended security model where system prompts should be controlled by the server admin, not the client.
- **Suggested Fix**: Make system prompt override optional based on a server-side configuration flag. Alternatively, only allow system prompt in `ChatCompletionRequest.system` if explicitly enabled in config.

## Resource Leaks

### 1. Timeout Not Cleared on Process Kill (Line 162-168 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 162-178
- **Severity**: Low
- **Category**: Resource Leaks
- **Description**: Timeout cleanup is done correctly after process completion (line 175-177), but if `proc.kill()` fails or the process doesn't terminate, the timeout ID might leak. Also, `proc.stdin` is not explicitly checked before write - if undefined, `proc.stdin.write()` at line 158 will throw.
- **Suggested Fix**: Add null check for proc.stdin before writing: `if (useStdin && proc.stdin) { proc.stdin.write(options.query); proc.stdin.end(); }`

### 2. Stream Controller Not Closed on Early Error (Line 277 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 262-290
- **Severity**: Low
- **Category**: Resource Leaks
- **Description**: In the streaming handler, if an error occurs in the async generator consumption (before controller closes in finally), the ReadableStream might not be properly garbage collected. The finally block closes the controller but a downstream error in response processing could prevent proper cleanup.
- **Suggested Fix**: Wrap the entire stream response in a try-finally or use `ReadableStream.from()` pattern which handles cleanup automatically.

### 3. Rate Limiter Cleanup Interval Not Awaited (Line 404-416 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 404-416
- **Severity**: Low
- **Category**: Resource Leaks
- **Description**: `rateLimiter.stop()` is called on shutdown but the server may close before cleanup interval completes. In Bun, this is less critical than Node.js but could leave entries in memory if the process is forcefully killed.
- **Suggested Fix**: Await cleanup or add a grace period (50ms) after calling stop() before proceeding with exit.

## Logic Errors

### 1. Incorrect Model Name Selection (Line 150-152 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 150-152
- **Severity**: Medium
- **Category**: Logic Errors
- **Description**: Logic to select model name filters out models containing 'haiku': `find((m) => !m.includes('haiku'))`. This is backwards - it tries to find a model that does NOT contain 'haiku', but if the user used Haiku model, all keys might contain 'haiku' and the find returns undefined, defaulting to 'claude-code-cli'. Better approach: return actual model used or first key.
- **Suggested Fix**: Change to: `Object.keys(result.metadata.modelUsage)[0] || request.model || 'claude-code-cli'`

### 2. Session ID Handling Inconsistency (Line 81-82 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 80-82
- **Severity**: Low
- **Category**: Logic Errors
- **Description**: `hasSession` boolean is used to determine whether to inject context, but the actual check for session ID is at line 61. The variable name doesn't match its actual purpose - it's used to determine if we should ignore system prompt (line 87), but comment says it's for context injection (line 75). This could be confusing for future maintenance.
- **Suggested Fix**: Use clearer variable name like `isResumingSession` and add comments explaining why system prompt is not sent during resume.

### 3. Empty Query Handling Missing (Line 296-333 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 300-304
- **Severity**: Medium
- **Category**: Logic Errors
- **Description**: If resuming a session but there are no user messages, `buildPromptWithHistory` returns empty string (line 304). This empty query is then passed to Claude CLI which may fail silently or produce unexpected results.
- **Suggested Fix**: Validate that query is non-empty before passing to Claude CLI. Return error if no user message found when resuming.

## Edge Case Gaps

### 1. Missing Null Check for Content-Length (Line 217 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 215-230
- **Severity**: Medium
- **Category**: Edge Case Gaps
- **Description**: Content-Length header might be missing, 'undefined', or 'NaN'. `parseInt('0', 10)` returns 0, which passes the size check, but a huge body without Content-Length header could bypass the limit check.
- **Suggested Fix**: Check for missing header explicitly: `const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10); if (isNaN(contentLength)) { /* reject */ }`

### 2. Empty Messages Array Not Validated (Line 26 in api.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/types/api.ts
- **Lines**: 21-26
- **Severity**: Medium
- **Category**: Edge Case Gaps
- **Description**: `messages` is required but not validated to be non-empty. If client sends empty array, `buildPromptWithHistory` returns empty string which could cause silent failures or unexpected behavior.
- **Suggested Fix**: Add validation schema check that messages.length > 0.

### 3. Zero Budget Not Rejected (Line 79 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 79-81
- **Severity**: Low
- **Category**: Edge Case Gaps
- **Description**: Check `maxBudgetUsd > 0` correctly, but if client sends `maxBudgetUsd: -1`, it passes through. Negative budget is invalid.
- **Suggested Fix**: Change to `options.maxBudgetUsd && options.maxBudgetUsd > 0` to reject falsy or non-positive values.

### 4. Missing Fallback for Missing Metadata Usage Fields (Line 170-175 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 169-176
- **Severity**: Low
- **Category**: Edge Case Gaps
- **Description**: Usage fields use optional chaining with nullish coalesce (`result.metadata?.usage.inputTokens ?? 0`) but `result.metadata?.usage` could be undefined, making the entire expression return 0 incorrectly rather than a clearer indication of missing data.
- **Suggested Fix**: Add explicit null check: `const usage = result.metadata?.usage || { inputTokens: 0, outputTokens: 0, ... }`

## Error Handling

### 1. Silent Failure in JSON Parsing (Line 230-238 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 230-238
- **Severity**: High
- **Category**: Error Handling
- **Description**: When JSON parsing fails (line 196), the catch block treats it as success and returns raw text output (line 233). This silently hides JSON parsing errors. If Claude's output format changes, the fallback masks the issue rather than surfacing it.
- **Suggested Fix**: Log the parse error and return failure: `catch (parseError) { log.error('JSON parse failed:', parseError); return { success: false, ... error: 'Failed to parse Claude output' }`

### 2. Missing Error Context in Stream (Line 268-271 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 268-271
- **Severity**: Low
- **Category**: Error Handling
- **Description**: When an error is detected in stream (line 268), it's sent and breaks, but the error object structure isn't validated. If the error chunk is malformed, it won't be caught.
- **Suggested Fix**: Validate error chunk structure before enqueuing.

### 3. No Validation of Validation Errors (Line 48 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 44-53
- **Severity**: Low
- **Category**: Error Handling
- **Description**: `validation.errors` might be undefined but is passed directly to `details` object (line 51). If Zod doesn't return errors array, this could cause issues.
- **Suggested Fix**: Ensure errors array exists: `details: { errors: validation.errors || [] }`

### 4. Process Spawn Error Not Handled (Line 148-154 in claude-cli.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 147-154
- **Severity**: Medium
- **Category**: Error Handling
- **Description**: If `Bun.spawn()` throws synchronously (rare but possible for invalid arguments), it's not caught. The try-catch starts after the spawn call.
- **Suggested Fix**: Move `Bun.spawn()` inside try block or wrap in try-catch-finally from line 145.

## Performance Issues

### 1. Inefficient Rate Limiter Lookup (Line 81 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 80-82
- **Severity**: Low
- **Category**: Performance Issues
- **Description**: Filtering timestamps to remove old entries happens on every check (line 81). For high-traffic keys with many requests, this array filter is O(n) on every request. Could be optimized with binary search or other data structure.
- **Suggested Fix**: Consider using circular buffer or LinkedList for timestamps to avoid repeated filtering.

### 2. Unnecessary Cleanup Interval (Line 36 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 35-37
- **Severity**: Low
- **Category**: Performance Issues
- **Description**: Cleanup runs every 60 seconds regardless of activity. If server has no traffic, cleanup still runs. The interval is fixed at 60 seconds (matching window size) which could lead to entries being cleaned up just as they become active again.
- **Suggested Fix**: Make cleanup interval configurable and consider adaptive cleanup based on entry count.

### 3. Full Timestamp Array Copy in getStatus (Line 140 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 138-141
- **Severity**: Low
- **Category**: Performance Issues
- **Description**: `getStatus()` filters timestamps again (line 140), duplicating work from the previous `check()` call. Two full array iterations on the same data.
- **Suggested Fix**: Cache filtered timestamp count or use a more efficient data structure.

## Test Coverage Gaps

### 1. No Unit Tests for Rate Limiter Edge Cases
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 44-114
- **Severity**: Medium
- **Category**: Test Coverage Gaps
- **Description**: No test file found. Critical functionality like rate limit reset timing, entry cleanup, and block expiration logic is untested. Edge cases like:
  - Window boundary conditions
  - Cleanup removing active entries
  - Block expiration exactly at blockedUntil time
  - Concurrent requests hitting limit simultaneously
- **Suggested Fix**: Create comprehensive test suite covering: normal operation, window boundaries, cleanup behavior, concurrent access patterns, and edge cases in block timing.

### 2. No Tests for Claude CLI Error Parsing
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
- **Lines**: 194-238
- **Severity**: Medium
- **Category**: Test Coverage Gaps
- **Description**: Error handling for malformed JSON, timeouts, and process failures is not tested. No tests for:
  - Timeout behavior and cleanup
  - JSON parse failures and fallback
  - Various exit codes
  - Missing session_id in response
- **Suggested Fix**: Create test cases for all error paths and edge cases in Claude CLI execution.

### 3. No Tests for Streaming Implementation
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 262-293
- **Severity**: Medium
- **Category**: Test Coverage Gaps
- **Description**: Streaming response handling is untested. No tests for:
  - Chunk encoding and SSE format
  - Error handling mid-stream
  - Session ID in final chunk
  - [DONE] message format
- **Suggested Fix**: Create integration tests for streaming responses with various content sizes and error scenarios.

## Dead Code

### 1. Unused `record()` Method (Line 120-123 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 120-123
- **Severity**: Low
- **Category**: Dead Code
- **Description**: The `record()` method is exported and documented but never called. The check() method already records timestamps, making this method redundant. The comment even states "This method exists for API clarity" which is not a good reason to keep unused code.
- **Suggested Fix**: Remove the `record()` method or if it's part of a required interface, document why it's not used.

### 2. Unused `reset()` Method (Line 187-189 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 187-189
- **Severity**: Low
- **Category**: Dead Code
- **Description**: The `reset()` method is for "admin use" but is never called from the codebase. No admin endpoint exists to trigger rate limit resets.
- **Suggested Fix**: Either implement an admin endpoint to use this or remove the method. Consider security implications of allowing rate limit resets.

## Concurrency Issues

### 1. Race Condition in Rate Limiter Entry Creation (Line 56-60 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 56-60
- **Severity**: Medium
- **Category**: Concurrency Issues
- **Description**: Check-then-act pattern in rate limiter is not atomic. Between checking if entry exists (line 57) and creating it (line 59), another concurrent request could create the same entry, leading to lost updates or incorrect rate limit calculations.
- **Suggested Fix**: Use atomic operation or lock. Since Bun is single-threaded for each event loop turn, this is mitigated but could still be an issue if using worker threads.

### 2. Non-Atomic Timestamp Filtering (Line 81 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 80-81
- **Severity**: Low
- **Category**: Concurrency Issues
- **Description**: Filtering timestamps (line 81) removes old entries without synchronization. If cleanup runs concurrently, entries could be filtered out while another request is processing the same entry.
- **Suggested Fix**: Use immutable data structures or add synchronization if supporting true concurrency (worker threads).

### 3. Unsafe Modification of Timestamps Array (Line 159 in rate-limiter.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
- **Lines**: 157-160
- **Severity**: Low
- **Category**: Concurrency Issues
- **Description**: Cleanup modifies the timestamps array while check() method might be iterating. In Bun's single-threaded model this is OK, but if code is ever moved to support workers, this would be unsafe.
- **Suggested Fix**: Use copy-on-write or immutable updates: `entry.timestamps = entry.timestamps.filter(...)` instead of modifying in place.

## API Contract Violations

### 1. Missing session_id in Chat Completion Chunk (Line 237 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 213-225
- **Severity**: Medium
- **Category**: API Contract Violations
- **Description**: Intermediate chunks don't include session_id (lines 213-225), only the final chunk includes it (line 241). OpenAI spec shows session_id should be in final chunk, which is correct, but inconsistent with non-streaming response which includes it in all completion objects. For client clarity, should be more explicit.
- **Suggested Fix**: Add comment explaining why session_id is only in final chunk. Consider including session_id in all chunks for consistency with non-streaming API.

### 2. finish_reason Always 'stop' (Line 238 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 160-167 and 234-239
- **Severity**: Low
- **Category**: API Contract Violations
- **Description**: `finish_reason` is hardcoded to 'stop' in both streaming and non-streaming responses. Should reflect actual completion reason (e.g., 'length' if max_tokens reached, 'content_filter' if filtered). No mechanism to detect actual reason from Claude output.
- **Suggested Fix**: Parse Claude's output to detect if max_tokens was reached or content was filtered, and set finish_reason accordingly.

### 3. Missing X-RateLimit-Limit Header Variance (Line 106 in index.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
- **Lines**: 104-110
- **Severity**: Low
- **Category**: API Contract Violations
- **Description**: `X-RateLimit-Limit` header is hardcoded to '60' (line 106) but the actual limit comes from config which could be different. If RATE_LIMIT_MAX environment variable is set to a different value, the header is incorrect.
- **Suggested Fix**: Change line 106 to: `'X-RateLimit-Limit': String(result.remaining + 1 + config.rateLimit?.maxRequests - 1)` or pass config to rateLimitHeaders function.

### 4. Model Field Mismatch in Streaming (Line 217 in chat.ts)
- **File**: /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
- **Lines**: 213-225
- **Severity**: Low
- **Category**: API Contract Violations
- **Description**: Streaming chunks use hardcoded model 'claude-code-cli' (line 217) while non-streaming response uses computed model name (line 158). Should use the same logic in both paths.
- **Suggested Fix**: Compute model name once and pass to both streaming and non-streaming response builders.

## Summary

Total issues: 32
Critical: 1
High: 3
Medium: 11
Low: 17

### Critical Issues
1. Silent JSON parsing failure masking output format changes (claude-cli.ts:230-238)

### High Issues
1. Command injection via JSON schema validation (claude-cli.ts:87-89)
2. Rate limiter token collision due to truncation (rate-limiter.ts:250)
3. Process spawn error not caught (claude-cli.ts:147-154)

### Medium Issues
1. UUID validation case sensitivity inconsistency (index.ts:236-253)
2. CORS wildcard allow-origin without enforcement (index.ts:96-101)
3. System prompt injection via user input (chat.ts:70-73)
4. Incorrect model name selection logic (chat.ts:150-152)
5. Empty query when resuming session (claude-cli.ts:300-304)
6. Content-Length bypass via missing header (index.ts:215-230)
7. Empty messages array not validated (api.ts:21-26)
8. Rate limiter concurrent access race condition (rate-limiter.ts:56-60)
9. Missing test coverage for rate limiter (rate-limiter.ts:44-114)
10. Missing test coverage for Claude CLI errors (claude-cli.ts:194-238)
11. Missing test coverage for streaming (index.ts:262-293)
12. Session ID in streaming chunks inconsistent (chat.ts:213-225)

### Recommendations for Immediate Action
1. **CRITICAL**: Add proper error handling for JSON parsing failures with logging
2. **HIGH**: Validate JSON schema before passing to CLI
3. **HIGH**: Use full token hash or increase token truncation length
4. **MEDIUM**: Add comprehensive test coverage for rate limiting and error paths
5. **MEDIUM**: Normalize and validate all session IDs to lowercase
6. **MEDIUM**: Add validation for empty messages array
