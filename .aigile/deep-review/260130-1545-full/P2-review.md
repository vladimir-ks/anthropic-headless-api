# Review: P2 - Backend Adapters & CLI

## Critical Issues

**anthropic-api-adapter.ts:162-195** - Inefficient health check implementation. isAvailable() makes full API call with 1 token max_tokens instead of lightweight endpoint check. Wastes API quota and time per availability check. Recommendation: Use /models endpoint like OpenAI adapter, or implement dedicated health endpoint.

**openai-adapter.ts:100-123** - Identical issue: /models endpoint health check is called on every routing decision. For systems with many requests, this causes unnecessary API calls consuming quota.

**gemini-adapter.ts:181-204** - Same pattern: /models endpoint called on each availability check. Gemini quota may be consumed by health checks rather than actual requests.

**openrouter-adapter.ts:103-126** - Same inefficiency replicated across all API adapters.

**context-reader.ts:108-109** - Emoji characters (📁, 📄) hardcoded in directory listing. These should be configurable or removed for machine-readable output. API consumers may not expect Unicode in directory listings.

**router.ts:276-290** - Race condition potential: parallel availability checks launched without coordination. If all backends are checked simultaneously under high load, could trigger cascading timeouts. Implement circuit breaker or request dedupe.

## Important Issues

**anthropic-api-adapter.ts:94-96, openai-adapter.ts:56-58, gemini-adapter.ts:102-104, openrouter-adapter.ts:56-58** - Timeout implementation uses AbortController correctly, but clearTimeout in both try/finally and catch blocks (lines 111/117 in Anthropic, 72/78 in OpenAI, etc.). While safe due to idempotency, the dual cleanup is redundant. Consolidate to single finally block.

**claude-cli.ts:32-102** - validateJSONForCLI performs 8+ checks (depth, size, null bytes, control chars, nesting, shell metacharacters, etc.). While defense-in-depth is good, some checks are redundant: both getDepth() recursive check AND character-scan depth check verify same constraint. Consolidate for clarity.

**claude-cli.ts:232-254** - stdin write error handling catches error but doesn't log specific write failure details. If proc.stdin.write() fails, error message is generic. Add context about what was being written.

**process-pool.ts:54-55** - Queue cleanup interval set to 5000ms (5 seconds) with QUEUE_TIMEOUT_MS = 30000ms. Gap of 5 seconds means timed-out items could linger briefly before removal. For correctness, this is acceptable, but document the trade-off (CPU vs latency).

**router.ts:25-40** - withTimeout() utility creates new timeout for EACH backend availability check. In filterAvailable() with 5+ backends, this could create 5+ concurrent timeouts. Consider shared timeout or batch checking.

**context-reader.ts:100-102** - Hardcoded skip list: `['node_modules', '__pycache__', 'venv', '.git']`. Missing common directories: `.env` files (security), `dist/`, `build/`, `.next/`. If .env contains secrets and CONTEXT.md is included in context, could leak secrets via directory listing.

**anthropic-api-adapter.ts:147** - If response.json() succeeds but doesn't match AnthropicResponse shape, silent type coercion on line 129 could pass incomplete/malformed data downstream. Add validation of required fields.

**claude-cli.ts:317** - JSON parse error caught and treated as text fallback (lines 359-366). While graceful, this hides parse failures. Should log error when fallback occurs to aid debugging.

## Gaps

**Test coverage for adapters** - No dedicated unit tests for AnthropicAPIAdapter, OpenAIAdapter, GeminiAdapter, or OpenRouterAdapter execute() methods with various response formats and error scenarios. validateJSONForCLI has good coverage, but adapter response transformation logic untested.

**Missing health check optimization** - No caching of availability status with TTL. Each router decision triggers fresh availability checks. For 100 requests/sec, could mean 100+ API health checks/sec.

**No request deduplication** - Multiple simultaneous requests could trigger duplicate availability checks on same backend. Implement request coalescing.

**Timeout consistency** - API adapters use 60s for execute, 10s for health checks. Process pool uses 30s queue timeout. No documented reasoning or consistency across system.

**Process pool edge case** - If activeCount reaches maxConcurrent and a request completes while processNext() is executing, could lose a queue processing cycle. The processingNext flag helps but logic is subtle and underdocumented.

**Error handling asymmetry** - Claude CLI adapter (claude-cli-adapter.ts) wraps executeClaudeQuery() errors generically (line 46). Different error types (timeout, invalid args, auth) all become "Claude CLI execution failed". API adapters provide more specific error messages.

**Context file security** - readContextFromDirectory() validates base path but readContextFiles() (lines 184-189) does validateSafePath() on full filepath after join(). This could allow directory traversal if filenames parameter contains `../`. Should validate filenames BEFORE joining.

**API key exposure** - API adapters fetch keys from environment in constructor, but store as instance field. If process is dumped or debugged, apiKey field visible in memory. Consider using WeakMap or Proxy pattern for sensitive credentials.

**Missing adapter metrics** - No instrumentation in adapters for cost tracking, error rates, latency percentiles. router.ts has stats but adapters don't expose granular metrics.

## Summary

P2 contains well-structured adapter interfaces and solid process pooling foundation. Main concerns: (1) inefficient health checks duplicated across 4 API adapters consuming unnecessary quota, (2) potential race conditions in parallel availability checking, (3) untested response transformation logic in adapters, (4) directory listing includes security risks (.env skip missing), (5) error handling lacks specificity in some paths.

Security hardening is present (path validation, JSON validation, timeout handling) but process pool edge cases and error categorization need clarification. No critical vulnerabilities, but production-scale issues exist around availability check overhead.

## Fixes Immediately Applied

None - all issues require architectural consideration or coordination with broader system design. Recommend batching fixes with P1/P3 reviews to ensure consistency.
