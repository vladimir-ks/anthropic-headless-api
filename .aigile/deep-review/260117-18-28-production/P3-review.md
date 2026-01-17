---
metadata:
  modules: [lib, routes, validation]
  tldr: "Deep security and quality audit of CLI integration (claude-cli.ts, context-reader.ts). Identified 12 issues across security, resource management, error handling, and edge cases. Severity: 2 Critical, 4 High, 4 Medium, 2 Low."
  dependencies: []
  code_refs: [src/lib/claude-cli.ts, src/lib/context-reader.ts, src/routes/chat.ts]
---

# P3 Review: CLI Integration Audit

**Files Reviewed:**
- `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
- `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`

**Review Date:** 2026-01-17

---

## 1. SECURITY VULNERABILITIES

### Issue 1.1: Command Injection via Unvalidated JSON Parameters
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 88, 96
**Severity:** **CRITICAL**

**Description:**
`JSON.stringify()` is used directly on user-controlled objects (`options.jsonSchema` and `options.agents`) without prior validation. If these objects contain malicious values, the stringified JSON could be exploited if the CLI parses embedded escapes or special sequences.

```
Line 88:  args.push('--json-schema', JSON.stringify(options.jsonSchema));
Line 96:  args.push('--agents', JSON.stringify(options.agents));
```

**Risk:** While `Bun.spawn()` doesn't interpret shell escapes in arguments, the Claude CLI binary might process the JSON in unexpected ways if it contains deeply nested or specially-crafted structures. This is amplified by the request validation only checking basic structure with Zod, not content safety.

**Suggested Fix:**
- Add a JSON schema size limit (e.g., max 10KB after stringification)
- Add a recursion depth limit (max 5 levels)
- Validate stringified JSON output against whitelist patterns
- Consider sanitizing the stringified output before passing to CLI

---

### Issue 1.2: Arbitrary Directory Access via Path Traversal in Context Reading
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Lines:** 17-43
**Severity:** **CRITICAL**

**Description:**
`readContextFromDirectory()` accepts a `directory` parameter directly from the API request (via `request.working_directory` in chat.ts:57). No validation ensures the directory is within an allowed scope. An attacker can pass `../../../etc/passwd` or any absolute path to read arbitrary files on the system.

**Risk:** Information disclosure of sensitive files outside the intended working directory.

**Suggested Fix:**
- Resolve directory path to absolute: `path.resolve(directory)`
- Enforce a whitelist of allowed base directories (e.g., project root, configurable safe paths)
- Reject paths containing `..` or symbolic links pointing outside allowed scope
- Reject absolute paths not matching whitelist

Example:
```javascript
const allowedBase = '/var/projects';
const resolved = path.resolve(directory);
if (!resolved.startsWith(allowedBase)) {
  throw new Error('Directory access denied');
}
```

---

## 2. RESOURCE LEAKS

### Issue 2.1: stdin Stream Not Properly Closed on Error
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 157-160
**Severity:** **HIGH**

**Description:**
When `proc.stdin.write()` throws an error, `proc.stdin.end()` is not called. The stdin stream remains open, potentially blocking process cleanup.

```typescript
// Lines 157-160
if (useStdin && proc.stdin) {
  proc.stdin.write(options.query);  // If this throws, end() not called
  proc.stdin.end();
}
```

**Risk:** File descriptor leak, process may hang, resource exhaustion over many requests.

**Suggested Fix:**
Use try-catch or ensure closing:
```typescript
if (useStdin && proc.stdin) {
  try {
    proc.stdin.write(options.query);
  } finally {
    proc.stdin.end();
  }
}
```

---

### Issue 2.2: Stdout/Stderr Streams Not Explicitly Closed
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 181-182
**Severity:** **HIGH**

**Description:**
`proc.stdout` and `proc.stderr` are wrapped in `new Response()` but never explicitly closed. Bun may auto-close them, but this is not documented behavior. Relying on garbage collection is unsafe.

```typescript
const stdout = await new Response(proc.stdout).text();
const stderr = await new Response(proc.stderr).text();
```

**Risk:** Potential file descriptor leak in long-running server under load.

**Suggested Fix:**
Explicitly close streams after reading:
```typescript
const stdoutText = await new Response(proc.stdout).text();
const stderrText = await new Response(proc.stderr).text();
// Explicitly close (Bun may provide close() method or auto-close)
// Ensure streams are not held in memory
```

Or use Bun's native stream reading methods if available.

---

### Issue 2.3: Timeout Timer Cleared Only on Success Path
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 164-178
**Severity:** **MEDIUM**

**Description:**
The timeout timer is created and assigned to `timeoutId`, but only cleared in the success path (line 176). If `Promise.race()` throws an unexpected error before the timeout completes, the timer may not be cleared, causing a small leak.

```typescript
timeoutId = setTimeout(() => {
  proc.kill();
  reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
}, timeoutMs);

const exitCode = await Promise.race([proc.exited, timeoutPromise]);

// Timer only cleared here on success
if (timeoutId) {
  clearTimeout(timeoutId);
  timeoutId = null;
}
```

**Risk:** Multiple accumulated timers under high concurrency, memory leak in stress conditions.

**Suggested Fix:**
Use a `finally` block to guarantee cleanup:
```typescript
try {
  const exitCode = await Promise.race([proc.exited, timeoutPromise]);
  // handle result
} finally {
  if (timeoutId) {
    clearTimeout(timeoutId);
    timeoutId = null;
  }
}
```

---

## 3. LOGIC ERRORS

### Issue 3.1: Incorrect Conditional for useStdin Decision
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 122-127
**Severity:** **MEDIUM**

**Description:**
The `useStdin` flag is determined by checking for variadic args, but the logic doesn't account for the case where `options.query` itself is empty or the CLI might have different behavior expectations.

```typescript
const useStdin =
  (options.allowedTools && options.allowedTools.length > 0) ||
  (options.disallowedTools && options.disallowedTools.length > 0) ||
  (options.addDirs && options.addDirs.length > 0) ||
  (options.mcpConfig && options.mcpConfig.length > 0) ||
  (options.betas && options.betas.length > 0);
```

If `useStdin` is true but `options.query` is empty, stdin will receive empty input, which may cause the Claude CLI to hang or error unexpectedly.

**Risk:** Incomplete queries, hanging processes, or unclear error messages.

**Suggested Fix:**
Add explicit check:
```typescript
if (useStdin && !options.query) {
  throw new Error('Query cannot be empty when using stdin');
}
```

---

### Issue 3.2: Potential Null Reference in buildPromptWithHistory
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 324-330
**Severity:** **MEDIUM**

**Description:**
On line 304, if no user message is found (all messages filtered), `lastUserMessage?.content || ''` returns empty string. Then on line 324, `conversationMessages[conversationMessages.length - 1]` could be undefined if `conversationMessages` is empty (only system messages).

```typescript
const lastMessage = conversationMessages[conversationMessages.length - 1];
if (lastMessage) {
  // ...
}
```

The check guards against undefined, but this represents poor separation of concerns: the function should fail fast if given invalid input.

**Risk:** Silent empty query execution, wasted API calls.

**Suggested Fix:**
Validate input early:
```typescript
export function buildPromptWithHistory(
  messages: Array<{ role: string; content: string }>,
  hasSessionId: boolean
): string {
  if (!messages.length) {
    throw new Error('Messages array cannot be empty');
  }

  const userMessages = messages.filter((m) => m.role === 'user');
  if (!userMessages.length) {
    throw new Error('At least one user message is required');
  }
  // ... rest of logic
}
```

---

## 4. EDGE CASE GAPS

### Issue 4.1: Empty Query String Handling
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 27-254
**Severity:** **HIGH**

**Description:**
`executeClaudeQuery()` does not validate that `options.query` is non-empty. An empty or whitespace-only query will be passed to the Claude CLI, which may behave unpredictably or timeout.

```typescript
export async function executeClaudeQuery(
  options: ClaudeExecuteOptions
): Promise<ClaudeExecuteResult> {
  // No check: if (options.query.trim() === '') ...
```

**Risk:** Wasted API quota, timeout errors, confusing error messages to users.

**Suggested Fix:**
```typescript
if (!options.query || !options.query.trim()) {
  return {
    success: false,
    output: '',
    sessionId: null,
    metadata: null,
    error: 'Query cannot be empty',
  };
}
```

---

### Issue 4.2: Null/Undefined Metadata in ClaudeCliJsonOutput
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 208-222
**Severity:** **MEDIUM**

**Description:**
The metadata extraction assumes all fields in the JSON response exist. If the Claude CLI returns a response missing `usage` or `modelUsage` fields, this will crash with an undefined error.

```typescript
const metadata: ClaudeMetadata = {
  durationMs: jsonOutput.duration_ms,  // What if undefined?
  durationApiMs: jsonOutput.duration_api_ms,
  numTurns: jsonOutput.num_turns,
  totalCostUsd: jsonOutput.total_cost_usd,
  usage: {
    inputTokens: jsonOutput.usage.input_tokens,  // Assumed to exist
    // ...
  },
  // ...
};
```

**Risk:** Runtime crashes on unexpected CLI output, no graceful degradation.

**Suggested Fix:**
Provide defaults:
```typescript
const metadata: ClaudeMetadata = {
  durationMs: jsonOutput.duration_ms ?? 0,
  durationApiMs: jsonOutput.duration_api_ms ?? 0,
  numTurns: jsonOutput.num_turns ?? 0,
  totalCostUsd: jsonOutput.total_cost_usd ?? 0,
  usage: {
    inputTokens: jsonOutput.usage?.input_tokens ?? 0,
    outputTokens: jsonOutput.usage?.output_tokens ?? 0,
    cacheCreationTokens: jsonOutput.usage?.cache_creation_input_tokens ?? 0,
    cacheReadTokens: jsonOutput.usage?.cache_read_input_tokens ?? 0,
  },
  modelUsage: jsonOutput.modelUsage ?? {},
  uuid: jsonOutput.uuid ?? '',
};
```

---

### Issue 4.3: JSON Parsing Fallback Silently Succeeds
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 230-238
**Severity:** **MEDIUM**

**Description:**
When JSON parsing fails (line 230), the function returns `success: true` with the raw stdout as output (line 234). This is misleading—a parse failure should be an error state, not success.

```typescript
} catch (parseError) {
  // If JSON parsing fails, treat as text output (fallback)
  return {
    success: true,  // ← This is wrong; fallback ≠ success
    output: stdout.trim(),
    sessionId: null,
    metadata: null,
  };
}
```

**Risk:** Consumers believe the request succeeded when it actually failed to parse structured output. This breaks contract expectations.

**Suggested Fix:**
```typescript
} catch (parseError) {
  return {
    success: false,
    output: '',
    sessionId: null,
    metadata: null,
    error: `Failed to parse JSON output: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
  };
}
```

---

## 5. ERROR HANDLING

### Issue 5.1: Silent Permission Errors in Directory Traversal
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Lines:** 84-92
**Severity:** **MEDIUM**

**Description:**
Permission errors (EACCES, EPERM) are silently ignored without logging. While intentional for robustness, this masks real issues—a permission-denied error should at least be logged at debug level, not silently swallowed.

```typescript
} catch (error) {
  // Only silently skip permission errors; log unexpected errors
  const isPermissionError =
    error instanceof Error &&
    (error.message.includes('EACCES') || error.message.includes('EPERM'));
  if (!isPermissionError) {
    console.error(`[context-reader] Error reading ${dir}:`, error);
  }
  // ← Permission error silently ignored
}
```

**Risk:** Difficult debugging if file permissions are misconfigured; no audit trail of access attempts.

**Suggested Fix:**
```typescript
if (isPermissionError) {
  // Log at debug level for troubleshooting, don't break execution
  console.debug(`[context-reader] Permission denied reading ${dir}`);
} else {
  console.error(`[context-reader] Error reading ${dir}:`, error);
}
```

---

### Issue 5.2: Generic Error Handling in readContextFiles
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Lines:** 140-150
**Severity:** **LOW**

**Description:**
If reading a specific context file fails, the error is logged but execution continues. The function returns a partial Map, which may silently miss critical context files without notification to the caller.

```typescript
for (const filename of filenames) {
  try {
    // ... read file
  } catch (error) {
    console.error(`Error reading ${filename}:`, error);
    // ← Continues silently; Map missing entry
  }
}
```

**Risk:** Silently incomplete context injection if a required file is unreadable.

**Suggested Fix:**
Return a tuple with missing files:
```typescript
export async function readContextFiles(
  directory: string,
  filenames: string[]
): Promise<{ contents: Map<string, string>; missing: string[] }> {
  const contents = new Map<string, string>();
  const missing: string[] = [];

  for (const filename of filenames) {
    try {
      // ... read file
    } catch (error) {
      console.error(`Error reading ${filename}:`, error);
      missing.push(filename);
    }
  }

  return { contents, missing };
}
```

---

## 6. PERFORMANCE ISSUES

### Issue 6.1: Inefficient Directory Listing with Stat Call per File
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Lines:** 78-81
**Severity:** **LOW**

**Description:**
For each directory entry, `stat()` is called separately to get file size. This causes N+1 filesystem calls. The `readdir()` with `withFileTypes: true` already returns dirent objects, but `stat()` is needed for size. Bun may have optimized this internally, but it's inefficient on systems with high filesystem latency.

```typescript
const stats = await stat(fullPath);  // Extra syscall per file
const sizeStr = formatFileSize(stats.size);
```

**Risk:** Slow directory listing on large directories or network filesystems.

**Suggested Fix:**
```typescript
// Use Bun.file() stat if available
const fileSize = await Bun.file(fullPath).size ?? 0;
```

Or batch stats calls if possible.

---

### Issue 6.2: No Limit on Directory Contents Output
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Lines:** 48-96
**Severity:** **MEDIUM**

**Description:**
The `listDirectoryContents()` function has a max depth but no limit on the number of files listed. A directory with 10,000+ files will create a massive string that's then injected into the system prompt, causing API timeouts and excessive token usage.

```typescript
async function listDirectoryContents(
  directory: string,
  maxDepth: number = 2  // Depth limit only
): Promise<string[]> {
  // No limit on total file count
  for (const entry of entries) {
    // ... adds every file to array
  }
}
```

**Risk:** Token usage explosion, timeout errors, API cost spikes for large projects.

**Suggested Fix:**
```typescript
const MAX_FILES = 500;  // Configurable
const MAX_TOTAL_SIZE = 50000;  // characters

async function listDirectoryContents(
  directory: string,
  maxDepth: number = 2,
  maxFiles: number = MAX_FILES
): Promise<string[]> {
  const contents: string[] = [];

  async function traverse(...) {
    // ... existing logic

    if (contents.length >= maxFiles) {
      contents.push(`[...truncated, showing ${maxFiles} of more files...]`);
      return;  // Stop traversing
    }
  }

  return contents;
}
```

---

## 7. TEST COVERAGE GAPS

### Issue 7.1: No Tests for executeClaudeQuery Error Paths
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Severity:** **HIGH**

**Description:**
The test suite (`tests/api.test.ts`) does not directly test `executeClaudeQuery()`. It only tests the validation layer and mocked response. Critical error paths are untested:
- Timeout handling (proc.kill)
- JSON parse failures
- Non-zero exit codes
- Stderr-only failures
- stdin write errors

**Risk:** Untested code paths may have bugs that surface in production.

**Suggested Fix:**
Create `/src/lib/__tests__/claude-cli.test.ts` with:
- Mock `Bun.spawn()` to simulate timeout
- Mock `Bun.spawn()` to return non-zero exit code
- Mock `Bun.spawn()` to return invalid JSON
- Test stdin write error handling
- Test timeout cancellation cleanup

---

### Issue 7.2: No Tests for readContextFromDirectory Path Traversal
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/context-reader.ts`
**Severity:** **CRITICAL**

**Description:**
No tests exist for path traversal scenarios (e.g., `../../../etc/passwd`). The function is untested against malicious input.

**Risk:** Security vulnerability not caught by automated tests.

**Suggested Fix:**
Create `/src/lib/__tests__/context-reader.test.ts` with:
- Test path traversal rejection: `readContextFromDirectory('../../../etc')`
- Test absolute path rejection: `readContextFromDirectory('/etc')`
- Test valid relative path acceptance
- Test symlink following prevention
- Test permission error handling

---

### Issue 7.3: No Test for Directory with Large File Count
**Severity:** **MEDIUM**

**Description:**
No test verifies behavior when listing a directory with 10,000+ files.

**Risk:** Performance issue only discovered in production.

**Suggested Fix:**
Add test creating a temp directory with many files and verify:
- Function completes in reasonable time
- Output is truncated gracefully
- No memory explosion

---

## 8. DEAD CODE

### Issue 8.1: Unused Variable in buildPromptWithHistory
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 303-304
**Severity:** **LOW**

**Description:**
The logic finds `lastUserMessage` by reversing and searching, but this is inefficient. The function could simply use `messages[messages.length - 1]` and check role directly.

```typescript
const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
return lastUserMessage?.content || '';
```

This is not dead code, but inefficient code. The `[...messages]` creates an unnecessary copy.

**Suggested Fix:**
```typescript
const lastUserMessage = messages.findLast((m) => m.role === 'user');
return lastUserMessage?.content || '';
```

Or iterate backwards directly if `findLast` unavailable:
```typescript
let lastUserMessage: (typeof messages)[0] | undefined;
for (let i = messages.length - 1; i >= 0; i--) {
  if (messages[i].role === 'user') {
    lastUserMessage = messages[i];
    break;
  }
}
return lastUserMessage?.content || '';
```

---

## 9. CONCURRENCY ISSUES

### Issue 9.1: Race Condition in Timeout Handling
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/lib/claude-cli.ts`
**Lines:** 164-178
**Severity:** **HIGH**

**Description:**
`Promise.race([proc.exited, timeoutPromise])` has a subtle race: if both promises resolve simultaneously (or very close), the race result is non-deterministic. Additionally, if `proc.exited` resolves after `timeoutPromise` rejects, the timeout cleanup code runs but `proc.kill()` may already be called redundantly.

```typescript
const exitCode = await Promise.race([proc.exited, timeoutPromise]);
```

**Risk:** Unpredictable behavior under high load; potential double-kill attempt.

**Suggested Fix:**
Track timeout state explicitly:
```typescript
let timedOut = false;
const timeoutPromise = new Promise<never>((_, reject) => {
  timeoutId = setTimeout(() => {
    timedOut = true;
    proc.kill();
    reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
  }, timeoutMs);
});

try {
  const exitCode = await Promise.race([proc.exited, timeoutPromise]);
  // ... handle normal exit
} catch (error) {
  if (timedOut) {
    // timeout path
  } else {
    // other error
  }
} finally {
  if (timeoutId) {
    clearTimeout(timeoutId);
  }
}
```

---

### Issue 9.2: No Locking on Session State Access
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts`
**Lines:** 56-98
**Severity:** **MEDIUM**

**Description:**
If the same `session_id` is used in concurrent requests, both requests will:
1. Read context (only if no session_id) ✓ (safe)
2. Execute `executeClaudeQuery()` with same session simultaneously

The Claude CLI may not support parallel access to the same session. This could lead to race conditions, corrupted session state, or out-of-order message handling.

**Risk:** Conversation corruption under concurrent access; unpredictable behavior.

**Suggested Fix:**
Implement session locking:
```typescript
const sessionLocks = new Map<string, Promise<void>>();

export async function handleChatCompletion(
  request: ChatCompletionRequest,
  config: ServerConfig
): Promise<ChatCompletionResponse | APIError> {
  if (request.session_id) {
    // Acquire lock for this session
    const existingLock = sessionLocks.get(request.session_id) ?? Promise.resolve();

    const newLock = existingLock.then(async () => {
      // Execute within lock
      return handleChatCompletionInternal(request, config);
    });

    sessionLocks.set(request.session_id, newLock);
    return newLock;
  }

  // No session, no locking needed
  return handleChatCompletionInternal(request, config);
}
```

---

## 10. API CONTRACT VIOLATIONS

### Issue 10.1: session_id UUID Validation Not Enforced
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/validation/schemas.ts`
**Lines:** 58
**Severity:** **MEDIUM**

**Description:**
Schema requires `session_id` to be a valid UUID (line 58: `.uuid()`), but this is not validated on the CLI side. If the Claude CLI returns a session_id that's not a valid UUID, it will be passed back to clients who may reject it due to schema validation.

```typescript
session_id: z.string().uuid().optional(),  // Client-side validation
```

But what if Claude CLI returns `session-abc-123` (not UUID)?

**Risk:** Validation mismatch; clients can't reuse returned session_ids if they don't conform to UUID format.

**Suggested Fix:**
Validate and transform session_id from CLI:
```typescript
// In claude-cli.ts, when extracting sessionId:
let sessionId = jsonOutput.session_id;

// Validate it matches UUID format, or reject
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (sessionId && !uuidRegex.test(sessionId)) {
  sessionId = null;  // Discard invalid session_id
  console.warn('Claude CLI returned invalid session_id format');
}
```

---

### Issue 10.2: metadata Field Always Included Even on Errors
**File:** `/Users/vmks/_dev_tools/anthropic-headless-api/src/routes/chat.ts`
**Lines:** 178-181
**Severity:** **LOW**

**Description:**
The response schema includes `claude_metadata: ClaudeMetadata | undefined` (optional). However, the code includes it in all responses:

```typescript
const response: ChatCompletionResponse = {
  // ...
  claude_metadata: result.metadata || undefined,  // Always included (as undefined)
};
```

This is not a contract violation, but it's inconsistent with OpenAI spec, which doesn't include metadata fields in error responses. The optional field is correctly handled, but it's confusing to include it at all when null.

**Risk:** Confusing API behavior; clients may not handle undefined fields correctly.

**Suggested Fix:**
Omit metadata entirely if null:
```typescript
const response: ChatCompletionResponse = {
  id: completionId,
  object: 'chat.completion',
  created: Math.floor(Date.now() / 1000),
  model: modelName,
  choices: [...],
  usage: {...},
  session_id: result.sessionId || undefined,
};

if (result.metadata) {
  response.claude_metadata = result.metadata;
}
```

---

## Summary by Severity

| Severity | Count | Issues |
|----------|-------|--------|
| **CRITICAL** | 2 | 1.1 (JSON injection), 1.2 (Path traversal), 7.2 (Test gap for path traversal) |
| **HIGH** | 4 | 2.1 (stdin leak), 2.2 (stream leak), 4.1 (empty query), 7.1 (executeClaudeQuery tests), 9.1 (timeout race) |
| **MEDIUM** | 4 | 2.3 (timer leak), 3.1 (useStdin logic), 3.2 (null ref), 4.2 (missing metadata), 4.3 (parse fallback), 5.1 (silent perms), 6.2 (file count limit), 10.1 (UUID validation) |
| **LOW** | 2 | 5.2 (incomplete context), 8.1 (inefficient array copy), 10.2 (metadata always included) |

**Total Issues:** 12 distinct issues identified

---

## Recommended Action Plan

### Immediate (This Sprint)
1. **Issue 1.2:** Add path traversal validation to `readContextFromDirectory()`
2. **Issue 4.1:** Add empty query validation to `executeClaudeQuery()`
3. **Issue 2.1:** Add try-finally to stdin write
4. **Issue 9.1:** Refactor timeout handling with explicit state flag

### Short-term (Next Sprint)
5. **Issue 1.1:** Add JSON schema size/depth limits
6. **Issue 4.2:** Add null-coalescing defaults for metadata
7. **Issue 4.3:** Change JSON parse failure to error state
8. **Issue 6.2:** Add file count limit to directory listing
9. **Issue 9.2:** Implement session-level locking

### Testing (Next Sprint)
10. **Issue 7.1:** Create comprehensive test suite for `executeClaudeQuery()`
11. **Issue 7.2:** Create security tests for path traversal
12. **Issue 7.3:** Add performance test for large directories

### Polish (Backlog)
13. **Issue 5.1:** Add debug-level logging for permission errors
14. **Issue 10.1:** Validate/transform session_id from CLI
15. **Issue 8.1:** Replace inefficient array copy with `findLast()`
