# Review: P2 Backend Adapters

## Critical Issues

**anthropic-api-adapter.ts:99 - Type Safety: var reassignment**
- Line 99 uses `var response` declared and reassigned in try block. Should use `let` in single-scoped assignment. Current pattern risks accidental redeclaration if another `var response` exists in outer scope.

**openai-adapter.ts:61 - Type Safety: var reassignment**
- Same issue: Line 61 uses `var response`. Breaks encapsulation of try/finally block.

**openrouter-adapter.ts:61 - Type Safety: var reassignment**
- Same issue: Line 61 uses `var response`. Identical pattern across adapters.

**gemini-adapter.ts:107 - Type Safety: var reassignment**
- Same issue: Line 107 uses `var response`. Consistent error across all API adapters.

**anthropic-api-adapter.ts:99, openai-adapter.ts:61, openrouter-adapter.ts:61, gemini-adapter.ts:107 - Resource Leak: clearTimeout before catch**
- All API adapters have clearTimeout outside catch block. If error occurs DURING the fetch before response assigned, clearTimeout runs twice (once in catch, once in finally), but this is safe. However, timeout may not fire if response resolves immediately due to race. Pattern is fragile.

**anthropic-api-adapter.ts:146, gemini-adapter.ts:158 - Array Access Without Bounds Check**
- Line 146: `data.content[0]?.text` uses optional chaining BUT will crash if data.content is empty array and `.text` accessed on undefined.
- Line 158: `firstCandidate.content.parts[0]?.text` - same issue on parts array.
- These assume array has elements. Should validate length.

**gemini-adapter.ts:86 - Logic Error: System Message Injection**
- Line 86-89: System message injected as user message with prefix "System: {content}". This pollutes conversation history and breaks Gemini's understanding of true system context. System intent is lost in conversation flow.

## Important Issues

**base-adapter.ts:106-110 - Token Estimation Accuracy**
- Line 106-110: Assumes 4 chars = 1 token. Inaccurate for all models. Claude uses 1 token ≈ 3-4 chars, OpenAI ≈ 4-5 chars, Gemini varies. Estimation will be consistently wrong, affecting cost predictions.

**anthropic-api-adapter.ts:95-96, openai-adapter.ts:57-58, openrouter-adapter.ts:57-58, gemini-adapter.ts:103-104 - Hardcoded Timeout**
- 60 second timeout hardcoded in execute(). Should be configurable per backend. Gemini supports longer timeouts for large contexts.

**anthropic-api-adapter.ts:161-194, openai-adapter.ts:99-122, openrouter-adapter.ts:102-125, gemini-adapter.ts:180-203 - Health Check Not Equivalent to Execute**
- Health checks use different endpoints (/models vs /messages). A passing health check doesn't guarantee execute() will succeed. Should attempt small real request.

**all api adapters - No Request Validation**
- Missing validation of:
  - messages array not empty
  - max_tokens within provider limits (OpenAI 4096, Gemini 2M)
  - model name exists/is valid
  - temperature/top_p in valid ranges [0, 2], [0, 1]
- Zod validation mentioned in conventions but not used here.

**anthropic-api-adapter.ts:99, openai-adapter.ts:61, openrouter-adapter.ts:61, gemini-adapter.ts:107 - AbortController Signal Not Propagated**
- All API adapters create controller.signal but if fetch completes before timeout, signal remains uncleared. This is technically safe but the pattern is verbose. Could simplify.

**openai-adapter.ts:48 - Null Messages Handling**
- Line 48: request.messages passed directly without validating content not null/undefined. Should sanitize.

**claude-cli-adapter.ts:26-80 - Limited Error Context**
- No logging of request parameters for debugging. If execute fails, no visibility into what was sent.

## Gaps

**No Streaming Support**
- All adapters return ChatCompletionResponse synchronously. Comments mention "handle streaming separately" (openrouter-adapter:49) but no implementation. Streaming is critical for UX.

**No Cost Tracking**
- Adapters estimate cost but no recording/aggregation. No per-user cost tracking despite auth-pool module existing.

**No Rate Limiting Per Adapter**
- Backend registry allows parallel health checks (line 134-145) but no per-adapter rate limiting. Could hammer APIs.

**No Adapter-Specific Logging**
- No structured logging per adapter. useModuleLogger pattern mentioned in conventions but not used in adapters.

**No Tool Translation**
- ClaudeCLIAdapter passes tools through (line 38) but API adapters explicitly set supportsTools=false. No validation that tool requests fail gracefully.

**No Model Mapping**
- No alias/mapping for model names. Request model "claude-opus" but adapter expects "claude-3-5-sonnet-20241022". No translation layer.

**No Provider-Specific Headers**
- Gemini uses x-goog-api-key in header (correct). Anthropic uses x-api-key. No documentation of provider-specific requirements.

## Summary

Adapters implement OpenAI compatibility layer cleanly but have critical type safety issues (var vs let), array bounds violations, and weak resource cleanup patterns. Token estimation is fundamentally inaccurate. All API adapters hardcode 60s timeout. Health checks don't predict execute success. System message handling breaks on Gemini. Missing request validation, streaming, cost tracking, and structured logging. No per-adapter rate limiting creates API abuse risk.

Core architecture sound but implementation incomplete for production use.

## Fixes Immediately Applied

None - analysis only per review scope.
