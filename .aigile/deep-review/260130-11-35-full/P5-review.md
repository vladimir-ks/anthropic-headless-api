# Review: P5 Validation & Types

## Critical Issues

**src/validation/schemas.ts:67** - Weak path traversal validation. Regex-based check `!path.includes('..')` can be bypassed with URL encoding, alternate separators, or symlinks. Should use `path.resolve()` and validate canonicalized path against whitelist base.

**src/validation/schemas.ts:76** - Multiple hardcoded security checks scattered across different fields (context_files, add_dirs). Creates maintenance burden and inconsistent validation. No centralized path sanitization function.

**src/lib/claude-cli.ts:295** - Unsafe JSON parse without type guard. `JSON.parse()` result cast to `ClaudeCliJsonOutput` without validating required fields. If Claude returns malformed JSON missing `session_id`, `usage.input_tokens`, etc., accessing these fields causes undefined behavior or crashes.

**src/lib/claude-cli.ts:244** - Race condition in stdin write. `proc.stdin` type check `typeof proc.stdin !== 'number'` doesn't guarantee it's writable. Can throw if stream is already closed or in error state. No flow control on `write()`.

**src/lib/context-reader.ts:62** - Untyped `Bun.file()` call. Returns untyped object. Type safety not enforced. Should use explicit return type annotation or runtime type assertion.

**src/types/claude.ts:23** - Field `modelUsage` uses loose typing `Record<string, ClaudeModelUsage>`. No validation that values conform to `ClaudeModelUsage`. Runtime access to undefined properties can occur.

## Important Issues

**src/validation/schemas.ts:102** - Schema field `json_schema: z.record(z.string(), z.unknown())` is too permissive. Accepts any value type including functions, undefined, circular refs. No constraint on depth, size, or content. Should validate JSON-serializable types only.

**src/validation/schemas.ts:85** - Session ID regex `/^[a-zA-Z0-9\-]+$/` allows leading/trailing hyphens and pure numeric strings. No format validation. Could cause ambiguity in parsing. Should anchor and exclude edge cases.

**src/lib/claude-cli.ts:330-336** - JSON parse failure silently falls back to treating stdout as text. Loses all metadata (tokens, cost, duration). Hides protocol violations and makes debugging harder. Should throw error or return degraded response with warning.

**src/lib/claude-cli.ts:207-213** - `useStdin` logic is brittle. Decision based on presence of variadic args is implementation detail of Claude CLI. If CLI changes argument parsing, stdin logic breaks. No way for caller to explicitly control stdin usage.

**src/lib/context-reader.ts:41** - Console.error called in error path but no structured logging. Inconsistent with codebase's stated use of `createModuleLogger()`. Should use logger module.

**src/types/api.ts:38-39** - Field names use alternative field names for compatibility (`system_prompt` vs `system`). Documentation unclear which is preferred. No deprecation warning if one should be phased out.

**src/lib/claude-cli.ts:159, 169** - String conversion of array without null check. `String(options.maxBudgetUsd)` on number is safe, but pattern assumes value is always defined after optional check. Fragile if refactored.

## Gaps

**Missing: Cross-field validation**
- No validation that `allowed_tools` and `disallowed_tools` aren't both specified (mutually exclusive).
- No check that `session_id` and `continue_conversation` aren't both set (conflicting semantics).
- No validation that `fork_session` requires `session_id` or `continue_conversation`.

**Missing: Type-safe parsing of Claude CLI output**
- No Zod schema for `ClaudeCliJsonOutput`. Relies on manual type casting.
- No validation of `modelUsage` structure at parse time.
- `permission_denials` array type is loose (string[]).

**Missing: Validation of numeric bounds**
- `temperature` allows 0-2 but no validation of actual semantics (should be 0-1 for most use cases).
- `max_tokens` has no upper bound. Can accept unreasonable values.
- File count/tool count limits (100, 50, 20) are hardcoded magic numbers, not constants.

**Missing: Documentation of path validation semantics**
- `context_files`, `add_dirs`, `working_directory` use different validation rules.
- No clear spec: are relative paths allowed? symlinks? UNC paths on Windows?
- `validateSafePath()` resolves symlinks but earlier check in schemas uses string matching.

**Missing: Error recovery for context-reader**
- `readContextFromDirectory()` silently returns empty context on path validation failure.
- No way for caller to distinguish between "no context available" vs "access denied".
- `listDirectoryContents()` silently skips permission errors, hiding security issues.

**Missing: Timeout handling semantics**
- Default timeout (2 min) hardcoded. No way to override per-request.
- Race condition: timeout might fire after process exit but before stdout/stderr read.
- No distinction between "timeout" and "process killed by timeout" in error message.

**Missing: Session ID lifecycle management**
- No validation that resumed session_id is well-formed or still valid.
- No mechanism to invalidate or refresh stale sessions.
- `buildPromptWithHistory()` assumes sessions have full history available.

## Summary

P5 validation layer has solid Zod foundation but critical weaknesses in:

1. **Path security**: String-matching validation bypassed by normalization. Needs centralized `validateAndNormalizePath()` using resolved paths.

2. **Type safety**: Loose typing in JSON output parsing (`unknown`, `Record<string, unknown>`, unvalidated JSON.parse). Needs Zod schemas for all external data.

3. **Cross-field constraints**: No validation of mutually exclusive or dependent fields. Schema must enforce business logic.

4. **Edge cases**: Empty query validation exists but other fields lack bounds checking. Silent failures (JSON parse fallback, permission errors) hide bugs.

5. **Consistency**: Mixed logging (console.error vs logger), mixed path validation approaches, incomplete error recovery.

Immediate fixes: Type-safe Claude CLI output parsing, centralized path validation, cross-field constraints, explicit error handling.

## Fixes Immediately Applied

None. Review is analytical only.
