# Review: P6 Test Quality

## Critical Issues

**tests/security.test.ts:203** - Validation result not checked. Test expects `error instanceof Error` but validators return `ValidationError[]`. Schema validation errors must be checked against `validation.errors` array instead of exception handling.

**tests/router.test.ts:91** - Missing null check for async generator. `getAvailableBackends` returns `Promise<BackendAdapter[]>` but mock might not properly resolve. Type mismatch between `BackendRegistry.getAvailableBackends` return type and usage pattern.

**tests/api.test.ts:43-58** - Incomplete session_id validation in test server. UUID regex accepts invalid format (`[0-9a-f]` should be `[0-9a-fA-F]` for uppercase support). Schemas test both but test server enforces stricter pattern. Tests may pass with invalid UUIDs.

**tests/validation.test.ts:85** - Session_id validation incomplete. Schema only validates alphanumeric + hyphens `[a-zA-Z0-9\-]+` but allows formats like `abc-123-def-xyz` which aren't valid UUIDs despite being documented as UUID-format. Mismatches implementation in `path-validation.test.ts:79` which uses strict UUID `a1234567-b123-4123-8123-c12345678901`.

## Important Issues

**tests/router.test.ts:15-63** - MockBackend incomplete implementation. Missing `name` property initialization in constructor (`this.name = id` works but `name` field could be undefined until line 25). `execute()` hardcodes response timestamp using `Date.now()` - tests may have timing-dependent flakiness.

**tests/security.test.ts:156-167** - Inconsistent error handling pattern. Test tries to execute CLI with validation that should throw, but catches generic errors. Makes assumptions about error message format with `.not.toMatch()` which is fragile if error messages change.

**tests/validation.test.ts:148-165** - Tool control tests incomplete. Tests `allowed_tools`, `tools` as array, `tools` as string, but missing tests for:
  - Empty `allowed_tools` array (should be valid)
  - Empty `disallowed_tools` array
  - Conflicting `allowed_tools` and `disallowed_tools` simultaneously

**tests/path-validation.test.ts:56-66** - System directory blocking doesn't match implementation. Tests check for `/etc` and `/var` prefix match but schema validation uses `startsWith()` which allows `/var/custom/secure` to pass if not prefixed with `/var` exactly. Array bounds test creates 101 items but only checks first error.

**tests/api.test.ts:98-121** - SyntaxError detection fragile. Only catches `instanceof SyntaxError` but JSON.parse() in strict mode can throw other errors. Missing tests for:
  - Partial JSON payloads
  - Numbers exceeding safe integer limits
  - Deep nesting stress tests

## Gaps

**Missing negative test coverage:**
- No tests for race conditions between concurrent requests in router
- No tests for timeout behavior under load
- No tests for edge cases: single message with role!=user in array
- No tests for model parameter with invalid format (uppercase models like `claude-3-opus-20240229`)
- No tests for content larger than API limits (if any exist)

**No integration tests:**
- No end-to-end flow: validation → routing → execution
- No test for session_id persistence across requests
- No test for streaming mode with actual process pool
- No test for fallback behavior when explicit backend becomes unavailable mid-request

**Coverage gaps in validation:**
- No tests for `json_schema` parameter with valid structure (only depth/size/injection in security tests)
- No tests for `agents` parameter with valid structure
- No tests for mcp_config array element format
- No tests for `system` prompt override behavior

**Process/environment tests missing:**
- No tests verifying timeout cleanup (timeoutId cleared, process killed)
- No tests for environment variable passing to CLI
- No tests for stdin/stdout handling with edge cases (binary data, very large payloads)
- No tests for working directory security (symlinks, mount point escapes)

**Router coverage gaps:**
- No tests for backend selection when multiple backends have same cost
- No tests for process pool capacity threshold calculation
- No tests for exception handling in `execute()` when backend throws
- No tests for stats calculation accuracy across multiple requests

## Summary

Test suite achieves functional coverage of main paths but lacks rigor in edge cases, error handling consistency, and integration scenarios. Critical issues: session_id validation format mismatch between implementation and tests, incomplete validation error pattern matching, and missing race condition tests. Router tests use incomplete mocks missing null checks. Security tests make fragile assumptions about error messages. Recommend: standardize validation error checking, complete mock implementations, add integration tests, remove timing-dependent assertions, add concurrent request tests.

## Fixes Immediately Applied

None

