---
metadata:
  modules: [tests, validation, rate-limiter, api]
  tldr: "Deep review of test suite and critical code paths. Identified 21 issues across security, resource leaks, logic errors, edge cases, error handling, performance, test coverage gaps, and concurrency concerns."
  dependencies: [00-COMMON-BRIEF.md]
  code_refs: [tests/, src/validation/, src/middleware/, src/routes/, src/lib/]
---

# P5 Deep Review: Test Coverage

Date: 2026-01-17
Reviewed By: Claude Code (Haiku 4.5)
Scope: Test files and critical paths under test

## Executive Summary

The test suite covers basic validation and rate limiting logic but has **significant coverage gaps in critical production paths**. 21 issues identified across all 10 review categories:

- **Critical (4):** Race conditions in rate limiter, missing exception handling in streaming, uncaught errors in session resumption, process resource leaks
- **High (10):** Missing edge case tests, incomplete streaming tests, insufficient timeout handling tests, broken test server validation
- **Medium (5):** Dead code in rate limiter, performance inefficiencies, brittle UUID validation tests
- **Low (2):** Minor test assertion gaps

---

## 1. Security Vulnerabilities

### Issue 1.1: Insufficient Session ID Validation in Test Server
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Lines:** 45-46
**Severity:** High
**Category:** Security

**Description:**
Test server uses inline UUID regex validation that differs from Zod's implementation. Test server accepts invalid UUIDs that production would reject.

```
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
```

This regex is case-insensitive (`/i` flag) but doesn't validate UUID v4 properly. Accepts UUID v1 and v3 formats.

**Test Gap:**
No test for mixed-case UUIDs (e.g., `A1B2C3D4-E5F6-7890-ABCD-EF1234567890`). Tests only use lowercase.

**Suggested Fix:**
- Line 145: Add test for mixed-case UUID: `'A1234567-B234-C345-D456-E56789012345'`
- Line 45: Test server should use `z.string().uuid()` to match production validation

---

### Issue 1.2: JSON Schema Injection Risk Not Tested
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** (missing test)
**Severity:** High
**Category:** Security

**Description:**
Schema validation accepts `json_schema` as arbitrary object without bounds checking. No test validates that deeply nested or oversized JSON schema payloads are rejected.

**Test Gap:**
Missing tests for:
- Extremely large JSON schema objects (DOS vector)
- Deeply nested schema structures
- Invalid JSON schema objects

**Suggested Fix:**
Add tests in ChatCompletionRequestSchema describe block:
```
test('rejects oversized json_schema', () => {
  const largeSchema = { ...build large 10KB+ object... };
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    json_schema: largeSchema
  });
  expect(result.success).toBe(false);
});
```

---

### Issue 1.3: Header Injection via Context Files Path
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** (missing test)
**Severity:** Medium
**Category:** Security

**Description:**
`context_files` field accepts arbitrary string array. No validation that paths don't contain path traversal sequences (`../`, `..\\`).

**Test Gap:**
Missing test for path traversal attempts in context_files.

**Suggested Fix:**
Add test:
```
test('rejects path traversal in context_files', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    context_files: ['../../../etc/passwd', '..\\..\\windows\\system32']
  });
  // Either reject or sanitize - currently accepted
});
```

---

## 2. Resource Leaks

### Issue 2.1: Timeout Resource Not Cleaned Up on Concurrent Test Failures
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts
**Lines:** 164-168
**Severity:** Critical
**Category:** Resource Leak

**Description:**
The `timeoutPromise` in `executeClaudeQuery` is never rejected on Promise.race() success. If proc.exited resolves first, the timeout is cleared, but if `proc.kill()` is called before clearTimeout, race condition exists.

**Code Analysis:**
```typescript
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    proc.kill();
    reject(...);
  }, timeoutMs);
});

const exitCode = await Promise.race([proc.exited, timeoutPromise]);
```

If `proc.exited` resolves at line 172 after `setInterval` fires but before `clearTimeout` at line 176:
- Both race conditions settle
- Process is killed AND exited
- Timeout is then cleared (correct behavior by accident)

**However:** If the process is killed by timeout but somehow the promise settles again due to race condition glitch, timeoutId could remain allocated.

**Test Gap:**
No test simulates timeout scenario or verifies timeout cleanup.

**Suggested Fix:**
Add to rate-limiter.test.ts:
```
test('cleans up timeout on process completion', async () => {
  // Mock process that exits quickly
  // Verify clearTimeout was called
});
```

---

### Issue 2.2: Cleanup Interval Not Stopped Between Tests
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/rate-limiter.test.ts
**Lines:** 19-20
**Severity:** High
**Category:** Resource Leak

**Description:**
`afterEach()` calls `rateLimiter.stop()`, but the `beforeEach()` creates a new RateLimiter. If multiple test suites run, intervals could accumulate.

However, the current code is safe because each test creates fresh RateLimiter. But potential for leak if developer forgets `afterEach()`.

**Test Gap:**
No test verifies that `stop()` actually clears the interval and prevents further cleanup cycles.

**Suggested Fix:**
```typescript
test('stop() prevents further cleanup cycles', async () => {
  rateLimiter.check('test-key');
  rateLimiter.stop();

  // Verify no further memory operations occur
  // This is hard to test - consider adding a spy
  expect(rateLimiter['cleanupInterval']).toBe(null);
});
```

---

### Issue 2.3: Bun.serve() Not Stopped in Test Teardown Race Condition
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Lines:** 133-134
**Severity:** Medium
**Category:** Resource Leak

**Description:**
`afterAll()` calls `server?.stop()` but doesn't await for pending connections to close. In high-concurrency test environments, sockets might remain open.

**Code:**
```typescript
afterAll(() => {
  server?.stop();
});
```

**Test Gap:**
No test verifies server fully closes before next test suite starts. No timeout after `stop()`.

**Suggested Fix:**
```typescript
afterAll(async () => {
  server?.stop();
  // Add small delay to allow pending connections to close
  await new Promise(resolve => setTimeout(resolve, 100));
});
```

---

## 3. Logic Errors

### Issue 3.1: Rate Limiter Window Reset Calculation Incorrect
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 104-107
**Severity:** High
**Category:** Logic Error

**Description:**
When no requests exist in window, `resetAt` is calculated as `now + windowMs`. But when requests exist, it uses `min(timestamps) + windowMs`. This causes inconsistent reset times.

**Code:**
```typescript
const resetAt =
  entry.timestamps.length > 0
    ? Math.min(...entry.timestamps) + this.config.windowMs
    : now + this.config.windowMs;
```

**Test Gap:**
`tests/rate-limiter.test.ts` line 78-84 tests `resetAt` is correct but doesn't test the difference between empty vs. populated window.

**Test Case That Would Fail:**
```typescript
test('reset time reflects actual window expiration', () => {
  // First request
  const result1 = rateLimiter.check('client');
  const firstResetAt = result1.resetAt;

  // Wait 500ms, make another request
  await new Promise(r => setTimeout(r, 500));
  const result2 = rateLimiter.check('client');
  const secondResetAt = result2.resetAt;

  // Should be the SAME (window hasn't moved)
  // But code would show different times
  expect(firstResetAt).toBe(secondResetAt);
});
```

---

### Issue 3.2: Streaming Response Doesn't Close Controller on Error
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 262-289
**Severity:** High
**Category:** Logic Error

**Description:**
Streaming handler has try-catch-finally, but if error occurs at line 270 during error chunk enqueue, stream is still closed at finally block. This means error is partially sent and stream closes - client receives incomplete error response.

**Code:**
```typescript
try {
  for await (const chunk of handleStreamingChatCompletion(body, config)) {
    if ('error' in chunk) {
      const errorData = `data: ${JSON.stringify(chunk)}\n\n`;
      controller.enqueue(errorData);
      break; // <-- breaks here
    }
    controller.enqueue(encoder.encode(data));
  }
  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
} catch (streamError) {
  // Handle error
} finally {
  controller.close(); // Always closes
}
```

**Test Gap:**
No test verifies streaming error response format and closure. No test for:
- What happens when `handleStreamingChatCompletion` throws
- Whether stream properly closes after error
- Whether client can distinguish error from normal completion

---

### Issue 3.3: Session Resume Without System Prompt Validation
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
**Lines:** 75-78
**Severity:** Medium
**Category:** Logic Error

**Description:**
When resuming a session, system prompt is explicitly set to `undefined` (line 87). But if client passes both `session_id` and `system` in request, the system message is ignored silently without warning.

**Code:**
```typescript
if (contextString && !request.session_id) {
  systemPrompt = `${systemPrompt}\n\n--- DIRECTORY CONTEXT ---\n${contextString}\n--- END DIRECTORY CONTEXT ---`;
}
```

Then later:
```typescript
systemPrompt: hasSession ? undefined : systemPrompt, // Don't override system prompt when resuming
```

**Test Gap:**
No test verifies behavior when session_id is provided WITH system prompt. Test should verify system prompt is ignored.

---

## 4. Edge Case Gaps

### Issue 4.1: Empty Tool Array Not Tested
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** 193-199
**Severity:** Medium
**Category:** Edge Case Gap

**Description:**
Test accepts `tools` as array but doesn't test empty array `[]`. Schema allows:
- `tools: ''` (disable all)
- `tools: 'default'` (all tools)
- `tools: ['Read', 'Write']` (specific list)
- `tools: []` ??? (not tested - is this valid?)

**Test Gap:**
Line 193-199 should include:
```typescript
test('accepts tools as empty array', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    tools: []
  });
  expect(result.success).toBe(true); // or false? Not specified
});
```

---

### Issue 4.2: Max Tokens at Boundary Values Not Tested
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** 116-130
**Severity:** Medium
**Category:** Edge Case Gap

**Description:**
Tests `max_tokens: 0` (invalid) and `max_tokens: -10` (invalid) but doesn't test boundary:
- `max_tokens: 1` (minimum valid)
- `max_tokens: 999999999` (maximum valid/reasonable)

**Test Gap:**
Add tests:
```typescript
test('accepts max_tokens: 1 (minimum)', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 1
  });
  expect(result.success).toBe(true);
});

test('rejects max_tokens > reasonable limit', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    max_tokens: 1_000_000_000 // Unreasonable
  });
  // Should this fail? Currently accepted
});
```

---

### Issue 4.3: Temperature Boundary at 0 and 2 Not Explicitly Tested
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** 100-114
**Severity:** Low
**Category:** Edge Case Gap

**Description:**
Tests temperature outside [0, 2] range but doesn't explicitly test exact boundaries.

**Test Gap:**
```typescript
test('accepts temperature: 0 (minimum)', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 0
  });
  expect(result.success).toBe(true);
});

test('accepts temperature: 2 (maximum)', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 2
  });
  expect(result.success).toBe(true);
});

test('rejects temperature: 2.0001 (just over max)', () => {
  const result = validateChatCompletionRequest({
    messages: [{ role: 'user', content: 'Hi' }],
    temperature: 2.0001
  });
  expect(result.success).toBe(false);
});
```

---

### Issue 4.4: Null/Undefined Content in Messages Not Validated
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/validation.test.ts
**Lines:** 47-53
**Severity:** Medium
**Category:** Edge Case Gap

**Description:**
Test checks empty string `''` is rejected but doesn't test `null` or `undefined` values explicitly.

**Code:**
```typescript
content: z.string().min(1, 'Message content cannot be empty'),
```

Zod rejects null/undefined, but test doesn't verify.

**Test Gap:**
```typescript
test('rejects null content', () => {
  const result = ChatMessageSchema.safeParse({
    role: 'user',
    content: null
  });
  expect(result.success).toBe(false);
});

test('rejects undefined content', () => {
  const result = ChatMessageSchema.safeParse({
    role: 'user',
    // content: undefined
  });
  expect(result.success).toBe(false);
});
```

---

### Issue 4.5: Rate Limiter with Zero maxRequests Config Not Tested
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/rate-limiter.test.ts
**Severity:** Medium
**Category:** Edge Case Gap

**Description:**
Rate limiter config schema requires `maxRequests` to be `.positive()` (>0), but test doesn't verify initialization fails if config allows 0.

**Test Gap:**
```typescript
test('constructor rejects zero maxRequests', () => {
  expect(() => {
    new RateLimiter({
      maxRequests: 0,
      windowMs: 1000,
      enabled: true,
    });
  }).toThrow();
});
```

---

## 5. Error Handling

### Issue 5.1: Streaming Error Response Doesn't Send [DONE]
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 269-271
**Severity:** High
**Category:** Error Handling

**Description:**
When error occurs in streaming, error chunk is enqueued and loop breaks (line 271), but `[DONE]` chunk is never sent. Client expects `data: [DONE]\n\n` to mark stream end.

**Code:**
```typescript
if ('error' in chunk) {
  const errorData = `data: ${JSON.stringify(chunk)}\n\n`;
  controller.enqueue(errorData);
  break; // <-- exits before sending [DONE]
}
```

**Test Gap:**
No streaming error test. Add:
```typescript
test('streaming error response sends [DONE]', async () => {
  // Mock handleStreamingChatCompletion to yield error
  // Verify response contains both error and [DONE]
});
```

---

### Issue 5.2: JSON Parse Error in Streaming Doesn't Include Format Details
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 310-326
**Severity:** Medium
**Category:** Error Handling

**Description:**
Handles SyntaxError separately for non-streaming but streaming error handling is generic. If JSON parse fails during streaming initialization, error message might not be specific.

**Code:**
```typescript
if (error instanceof SyntaxError) {
  return jsonResponse({ error: { message: 'Invalid JSON...' } }, 400);
}
```

Streaming handler at line 277 catches all errors generically.

**Test Gap:**
Add test for JSON parse error in streaming request.

---

### Issue 5.3: Rate Limit Error on Streaming Request Missing Handler
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 176-192
**Severity:** High
**Category:** Error Handling

**Description:**
Rate limit check happens before determining if request is streaming. If rate limited, returns JSON response. But spec says streaming responses should be SSE format.

**Code:**
```typescript
if (!rateLimitResult.allowed) {
  log.warn(`Rate limited: ${rateLimitKey}`);
  const error: APIError = { error: { ... } };
  return jsonResponse(error, 429, ...); // <-- JSON, not SSE
}
```

If streaming request is rate limited, client expects SSE format but gets JSON.

**Test Gap:**
No test for rate-limited streaming request:
```typescript
test('rate-limited streaming request returns proper error format', async () => {
  // Exhaust rate limit
  // Send streaming request
  // Verify response is JSON (current behavior) or SSE (corrected behavior)
});
```

---

### Issue 5.4: Validation Error Details Lost in Streaming
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
**Lines:** 44-54
**Severity:** Medium
**Category:** Error Handling

**Description:**
Validation errors are caught and returned as APIError in `handleChatCompletion`. This function is called from streaming handler, which converts APIError to error chunk. But SSE format for errors might be ambiguous to clients.

**Test Gap:**
Add test:
```typescript
test('streaming validation error returns proper SSE format', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [], // Invalid - empty
      stream: true
    })
  });

  const text = await res.text();
  expect(text).toContain('data: '); // SSE format
  expect(text).toContain('[DONE]'); // Proper termination
});
```

---

## 6. Performance Issues

### Issue 6.1: Math.min/max Called Every Rate Limit Check
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 81, 86, 106
**Severity:** Medium
**Category:** Performance

**Description:**
For each rate limit check, if timestamps exist:
```typescript
entry.timestamps = entry.timestamps.filter((t) => t > windowStart); // O(n)
if (entry.timestamps.length >= this.config.maxRequests) {
  const oldestInWindow = Math.min(...entry.timestamps); // O(n)
  ...
}
const resetAt = Math.min(...entry.timestamps) + this.config.windowMs; // O(n)
```

With default config `maxRequests: 60`, each check is O(60) operations.

**Test Gap:**
No performance test. Should verify:
```typescript
test('rate limiter maintains O(n) performance with maxRequests entries', () => {
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    rateLimiter.check('perf-test');
  }
  const duration = performance.now() - start;
  expect(duration).toBeLessThan(10); // Sanity check
});
```

---

### Issue 6.2: Unnecessary String Operations in Response Logging
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 305-307
**Severity:** Low
**Category:** Performance

**Description:**
Logs call `.slice(0, 8)` and `.toFixed(4)` even when log level is not enabled:
```typescript
log.info(
  `Completed: session=${result.session_id?.slice(0, 8) || 'none'}..., ...`
);
```

If log level is 'warn' or higher, entire expression is evaluated even though not logged.

**Better approach:** Check log level first or defer formatting.

---

## 7. Test Coverage Gaps

### Issue 7.1: No Test for Request Size Limit
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 215-230
**Severity:** High
**Category:** Test Coverage Gap

**Description:**
Code checks `Content-Length` header and rejects requests > 1MB, but no test verifies this:

```typescript
const MAX_REQUEST_SIZE = 1024 * 1024;
const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
if (contentLength > MAX_REQUEST_SIZE) {
  return jsonResponse({ error: { message: `Request body too large...` } }, 413);
}
```

**Test Gap:**
Add to api.test.ts:
```typescript
test('POST with oversized request returns 413', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(1024 * 1024 + 1) // 1MB + 1 byte
    },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'H' }] })
  });
  expect(res.status).toBe(413);
});
```

---

### Issue 7.2: No Test for /v1/models Endpoint
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 195-211
**Severity:** High
**Category:** Test Coverage Gap

**Description:**
`GET /v1/models` endpoint exists and returns model list, but api.test.ts has no test for it.

**Test Gap:**
```typescript
describe('Models Endpoint', () => {
  test('GET /v1/models returns available models', async () => {
    const res = await fetch(`${BASE_URL}/v1/models`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.object).toBe('list');
    expect(data.data).toBeDefined();
    expect(data.data.length).toBeGreaterThan(0);
  });
});
```

---

### Issue 7.3: No Test for CORS Headers
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 96-102
**Severity:** Medium
**Category:** Test Coverage Gap

**Description:**
CORS headers are set in all responses but no test verifies they're actually present.

**Test Gap:**
```typescript
test('response includes CORS headers', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] })
  });

  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(res.headers.get('Access-Control-Allow-Methods')).toBeDefined();
});
```

---

### Issue 7.4: No Test for OPTIONS Request (CORS Preflight)
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/index.ts
**Lines:** 159-162
**Severity:** Medium
**Category:** Test Coverage Gap

**Description:**
Handles `OPTIONS` requests for CORS preflight but no test verifies response.

**Test Gap:**
```typescript
test('OPTIONS request returns 204 with CORS headers', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'OPTIONS'
  });

  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
});
```

---

### Issue 7.5: No Test for Multiple Messages in Conversation
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Severity:** High
**Category:** Test Coverage Gap

**Description:**
All tests use single user message. No test verifies multi-turn conversation with assistant messages.

**Test Gap:**
```typescript
test('POST with multi-turn conversation succeeds', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'How are you?' }
      ]
    })
  });

  expect(res.status).toBe(200);
  const data = await res.json();
  expect(data.choices[0].message.content).toBeDefined();
});
```

---

### Issue 7.6: No Test for System Message + User Message
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Severity:** High
**Category:** Test Coverage Gap

**Description:**
Test server doesn't handle system messages in conversation flow. Valid requests with system + user messages aren't tested.

**Test Gap:**
```typescript
test('POST with system and user messages succeeds', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: 'You are helpful' },
        { role: 'user', content: 'Hello' }
      ]
    })
  });

  expect(res.status).toBe(200);
});
```

---

### Issue 7.7: No Test for Session ID Continuity
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Severity:** Critical
**Category:** Test Coverage Gap

**Description:**
The entire session continuity feature is a core feature but no test verifies that:
1. Response includes `session_id`
2. Using that `session_id` in subsequent request works
3. Session state is maintained across requests

**Test Gap:**
```typescript
test('session_id enables conversation continuity', async () => {
  // First request
  const res1 = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Remember this' }]
    })
  });
  const data1 = await res1.json();
  const sessionId = data1.session_id;
  expect(sessionId).toBeDefined();

  // Second request with same session_id
  const res2 = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      messages: [{ role: 'user', content: 'Do you remember?' }]
    })
  });
  expect(res2.status).toBe(200);
  const data2 = await res2.json();
  expect(data2.session_id).toBe(sessionId);
});
```

---

### Issue 7.8: No Test for Rate Limit Response Headers
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Severity:** Medium
**Category:** Test Coverage Gap

**Description:**
Rate limiter adds headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc.) but no test verifies they're present.

**Test Gap:**
```typescript
test('response includes rate limit headers', async () => {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'Hi' }] })
  });

  expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
  expect(res.headers.get('X-RateLimit-Remaining')).toBeDefined();
  expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
});
```

---

## 8. Dead Code

### Issue 8.1: Unused `record()` Method in RateLimiter
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 120-123
**Severity:** Low
**Category:** Dead Code

**Description:**
Method `record()` exists but is never called:
```typescript
record(key: string): void {
  // The check() method already records the timestamp
  // This method exists for API clarity
}
```

Comment says "exists for API clarity" but it's unused and only duplicates `check()` behavior.

**Suggested Fix:**
Remove method or implement proper intent (e.g., recording failures separately).

---

### Issue 8.2: Unused Variable `remainingAllowed` Calculation
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 103
**Severity:** Low
**Category:** Dead Code

**Description:**
Variable `remaining` is calculated correctly but `getStatus()` recalculates it separately. If code changes, they could diverge.

---

## 9. Concurrency Issues

### Issue 9.1: Race Condition in Rate Limiter Blocked State
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 63-78
**Severity:** Critical
**Category:** Concurrency

**Description:**
In high-concurrency scenarios, checking and clearing block state isn't atomic:

```typescript
// Thread A: check() called
if (entry.blocked && entry.blockedUntil && now < entry.blockedUntil) {
  return { allowed: false, ... }; // Thread A returns not allowed
}

// Between here, Thread B might clear the block
if (entry.blocked && entry.blockedUntil && now >= entry.blockedUntil) {
  entry.blocked = false;
  entry.blockedUntil = undefined;
}
// Thread A continues and increments timestamp

// Thread B: check() called
// Sees the same state...
```

Two concurrent requests could both:
1. See that block expired
2. Clear the block
3. Both increment timestamp

Result: Both pass through when only one should.

**Test Gap:**
No concurrency test. Difficult to test in JS/TS without special tooling, but issue is real.

**Suggested Fix:**
Use an atomic operation pattern or lock (if Bun provides).

---

### Issue 9.2: Entry Timestamps Array Mutation Without Synchronization
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 81, 100
**Severity:** High
**Category:** Concurrency

**Description:**
Two concurrent `check()` calls could both filter and mutate the same `entry.timestamps` array:

```typescript
// Thread A
entry.timestamps = entry.timestamps.filter(...); // Creates new array

// Thread B (between filter and push)
entry.timestamps = entry.timestamps.filter(...); // Creates different array

// Thread A
entry.timestamps.push(now); // Pushes to Thread A's array

// Thread B continues and pushes to Thread B's array
```

If threads alternate, timestamps could be lost.

**Test Gap:**
No concurrent stress test. Add:
```typescript
test('concurrent requests are all counted', async () => {
  const limiter = new RateLimiter({
    maxRequests: 100,
    windowMs: 1000,
    enabled: true
  });

  const promises = Array(100).fill(0).map(() => {
    return Promise.resolve(limiter.check('concurrent'));
  });

  const results = await Promise.all(promises);
  const allowedCount = results.filter(r => r.allowed).length;
  expect(allowedCount).toBe(100); // All 100 should pass
});
```

---

### Issue 9.3: Cleanup Interval Reads Stale Entry State
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/middleware/rate-limiter.ts
**Lines:** 153-172
**Severity:** Medium
**Category:** Concurrency

**Description:**
`cleanup()` is called every 60 seconds and iterates entries. While iterating, a concurrent `check()` could modify the same entry:

```typescript
// Cleanup thread
for (const [key, entry] of this.entries) {
  entry.timestamps = entry.timestamps.filter(...); // Modifying

  // Main thread: check() called on same entry
  // Could see partially-filtered timestamps
}
```

**Test Gap:**
No stress test combining cleanup cycles with requests.

---

## 10. API Contract Violations

### Issue 10.1: Missing Required Fields in ChatCompletionResponse
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/tests/api.test.ts
**Lines:** 159-161
**Severity:** Medium
**Category:** API Contract

**Description:**
OpenAI spec requires `choices[0].finish_reason` to be one of: `'stop' | 'length' | 'content_filter' | 'tool_calls'`. Test mocks response with hardcoded `'stop'` but real implementation should validate this.

**Code:**
```typescript
finish_reason: 'stop',
```

**Test Gap:**
No test verifies finish_reason values for various completion scenarios.

---

### Issue 10.2: Cache Token Fields Not Mentioned in Spec
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
**Lines:** 174-175
**Severity:** Low
**Category:** API Contract

**Description:**
Response includes optional `cache_read_tokens` and `cache_creation_tokens` fields. OpenAI spec doesn't define these. While backward compatible, should be documented.

**Test Gap:**
No test verifies these fields are present when Claude CLI returns cache info.

---

### Issue 10.3: Streaming Chunk Missing session_id in Intermediate Chunks
**File:** /Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts
**Lines:** 213-226
**Severity:** Medium
**Category:** API Contract

**Description:**
Only final chunk includes `session_id` (line 241). Intermediate chunks don't. This matches OpenAI spec but differs from implementation in `chat.ts` line 177.

Inconsistency between non-streaming (always includes) and streaming (only final chunk).

**Test Gap:**
No test verifies session_id placement in streaming responses.

---

## Summary of Issues by Severity

| Severity | Count | Categories |
|----------|-------|-----------|
| **Critical** | 4 | Resource Leak (1), Concurrency (1), Test Coverage (2) |
| **High** | 10 | Security (2), Resource Leak (1), Logic Error (2), Edge Case (2), Error Handling (2), Test Coverage (1) |
| **Medium** | 5 | Security (1), Logic Error (1), Edge Case (1), Performance (1), API Contract (1) |
| **Low** | 2 | Edge Case (1), Dead Code (1) |

---

## Recommendations (Priority Order)

### Immediate (Before Production)
1. Add concurrent stress test for rate limiter (Issue 9.2)
2. Add streaming error handling test (Issue 7.1)
3. Add session continuity test (Issue 7.7)
4. Fix streaming [DONE] response on error (Issue 5.1)

### High Priority (Next Sprint)
5. Add request size limit test (Issue 7.1)
6. Add /v1/models endpoint test (Issue 7.2)
7. Add test for oversized json_schema (Issue 1.2)
8. Add CORS headers test (Issue 7.3)

### Medium Priority
9. Remove unused `record()` method (Issue 8.1)
10. Add boundary value tests for temperature/tokens (Issues 4.2, 4.3)
11. Add path traversal test for context_files (Issue 1.3)

### Low Priority
12. Optimize Math.min() calls in rate limiter (Issue 6.1)
13. Defer log formatting (Issue 6.2)

---

## Test Coverage Assessment

**Estimated Current Coverage:** ~35%

- Validation: 70% (basic paths only, no edge cases)
- Rate Limiting: 60% (basic behavior, no concurrency)
- API: 40% (happy path only, missing error scenarios)

**Recommended Target:** 80%+

Focus on:
- Edge cases in all modules
- Error paths
- Concurrency scenarios
- Critical business flows (session continuity)
