# Review: P2 Multi-Backend Adapters

## Critical Issues

### 1. gemini-adapter.ts:102 - API Key Exposure in URL Query Parameter
API key embedded directly in URL query string instead of using secure header.
```
const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent?key=${this.apiKey}`;
```
**Impact:** API key visible in browser history, logs, proxies, and network traces.
**Risk:** High - Credential theft, unauthorized API access.

### 2. gemini-adapter.ts:161 - Unvalidated URL Construction in Health Check
Same API key exposure pattern in `isAvailable()` method.
```
const url = `${this.config.baseUrl}/models?key=${this.apiKey}`;
```

### 3. anthropic-api-adapter.ts:159 - Logic Error in Health Check
Health check marks backend available on 400 errors, signaling "unavailable" as "available."
```
return response.status === 200 || response.status === 400;
```
**Impact:** Router routes to failed backend, cascading failures.
**Risk:** Medium - Requests fail when backend appears healthy.

### 4. All adapters - Unhandled Response JSON Parsing Errors
`response.json()` can throw if response isn't valid JSON. No try-catch wrapper.
```
const data = (await response.json()) as ChatCompletionResponse;  // anthropic-api-adapter.ts:112
```
**Impact:** Unhandled promise rejections, silent failures, no error logging.
**Risk:** High - Requests crash without proper error messages.
**Affected files:**
- anthropic-api-adapter.ts:112
- openai-adapter.ts:73
- gemini-adapter.ts:118
- openrouter-adapter.ts:75

### 5. All adapters - Inadequate Error Response Handling
Response bodies not validated before throwing errors. Untrusted string concatenation.
```
throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
```
**Impact:** Error messages could exceed buffer limits or contain control characters.
**Risk:** Medium - Potential DoS or log injection.

## Important Issues

### 1. base-adapter.ts:107-109 - Crude Token Estimation
Hardcoded 4-char-per-token approximation unreliable for cost calculation.
```
const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
return Math.ceil(totalChars / 4);
```
**Impact:** Cost estimates wildly inaccurate, especially for non-ASCII text.
**Risk:** Medium - Billing discrepancies, user complaints.

### 2. anthropic-api-adapter.ts:127 - Mapping Error
`stop_reason === 'end_turn'` assumed but Anthropic returns `'end_turn'` or `'max_tokens'`.
```
finish_reason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
```
**Impact:** Incorrect finish_reason for max_tokens scenarios.

### 3. gemini-adapter.ts:84-89 - System Message Handling Fragile
Prefixing system prompt as user message changes semantics, not idiomatic.
```
parts: [{ text: `System: ${systemMessage.content}` }],
```
**Impact:** Model confusion, different behavior than intended.
**Risk:** Medium - Behavioral difference from spec.

### 4. router.ts:251-260 - Race Condition in Availability Checks
Parallel availability checks don't account for state changes between check and use.
```
const results = await Promise.all(availabilityChecks);
return results.filter((b): b is BackendAdapter => b !== null);
```
**Impact:** Selected backend may become unavailable between check and routing.

### 5. All adapters - Missing Timeout Enforcement
Fetch calls have no timeout configuration. Long-hanging requests starve process pool.
```
const response = await fetch(url, { ... });  // No timeout
```
**Impact:** Resource exhaustion, request pile-up.
**Risk:** Medium - DoS vulnerability.

### 6. backend-registry.ts:32-33 - No Config Validation
JSON parse directly without schema validation or error handling.
```
const configContent = readFileSync(resolve(configPath), 'utf-8');
this.config = JSON.parse(configContent) as BackendsConfig;
```
**Impact:** Invalid backends.json silently produces runtime errors.
**Risk:** Medium - Operational failure.

### 7. All adapters - No Logging of Adapter Selection Decision
Router decides backend but adapters don't log execution path. Debugging difficult.
**Impact:** Hard to trace routing decisions in production.

### 8. openrouter-adapter.ts:62-63 - Hardcoded Metadata Headers
GitHub URL hardcoded. Not configurable.
```
'HTTP-Referer': 'https://github.com/anthropic/headless-api',
'X-Title': 'Anthropic Headless API Gateway',
```

## Gaps

### 1. Missing Streaming Support
All adapters return non-streaming responses, but router doesn't check `stream` flag.
Request stream=true silently ignored, client gets single response.

### 2. No Tool Support Enforcement
API adapters return supportsTools=false, but router doesn't reject tool requests.
Tool requests fallback to API, losing functionality without error.

### 3. Missing Response Validation
No validation that API responses match ChatCompletionResponse contract.
Malformed responses from backends propagate to clients.

### 4. No Retry Logic
Single failure = request fails. No exponential backoff for transient errors.
**Impact:** Increased failure rates for flaky backends.

### 5. Missing Cost Tracking Granularity
Cost estimation at request time, not actual usage time. No per-token tracking.
**Impact:** Billing inaccuracy for long-running requests.

### 6. No Adapter Health Degradation
Backend goes from "healthy" to "error" instantly. No circuit breaker.
Cascading failures when backend becomes intermittently available.

### 7. Missing Model Validation
Adapter accepts any model string. No validation that model exists on backend.
**Impact:** Requests fail after routing to wrong adapter.

### 8. No Rate Limit Propagation
API rate limit responses (429) thrown as errors, not communicated to router.
Router doesn't backoff, hammering rate-limited backends.

## Summary

**P2 adapters enable multi-backend routing but have critical security and reliability gaps:**

- **Security:** Gemini API key exposed in URLs. Unhandled JSON parsing. Error messages not sanitized.
- **Reliability:** No timeout enforcement. Race conditions in availability checks. Inadequate response validation.
- **Operational:** Crude cost estimation. No logging. No streaming. Missing retry logic.
- **Design:** No tool enforcement. No circuit breaker. No rate limit awareness.

**Severity breakdown:**
- 5 Critical (API key exposure, unhandled exceptions, health check logic error)
- 8 Important (timeouts, validation, error handling, cost estimation)
- 8 Gaps (streaming, retry, circuit breaker, rate limits)

**Recommended fixes (priority):**
1. Move Gemini API key to Authorization header
2. Add try-catch wrapper around response.json() in all adapters
3. Fix Anthropic health check logic (remove 400 response)
4. Add request timeouts to all fetch calls
5. Add response validation for ChatCompletionResponse contract

## Fixes Immediately Applied

None applied - report-first protocol observed. All issues documented for user review before remediation.
