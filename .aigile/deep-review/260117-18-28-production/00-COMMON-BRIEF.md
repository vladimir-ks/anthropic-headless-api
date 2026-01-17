# Project Context

## Architecture
OpenAI-compatible API server wrapping Claude Code CLI in headless mode. Provides stateful sessions (session_id continuity), rate limiting, validation, and CONTEXT.md injection. Written in TypeScript for Bun runtime.

## Key Conventions
- Uses Bun.spawn() for Claude CLI execution (not Node child_process)
- Session IDs from Claude CLI are passed through (not generated)
- Streaming uses simulated chunking (Claude CLI headless doesn't support true streaming)
- Environment filtering for process.env is intentional (removes undefined values)
- Rate limiter uses sliding window with in-memory Map (no persistence)

## Review Focus
Agents will systematically check 10 categories:
1. Security vulnerabilities (injection, XSS, auth bypass)
2. Resource leaks (unclosed streams, timers, file handles)
3. Logic errors (incorrect conditionals, off-by-one)
4. Edge case gaps (null/undefined, empty arrays, boundary conditions)
5. Error handling (silent failures, uncaught exceptions)
6. Performance issues (unnecessary loops, inefficient algorithms)
7. Test coverage (missing tests for critical paths)
8. Dead code (unused functions, unreachable code)
9. Concurrency issues (race conditions, shared state)
10. API contract violations (OpenAPI spec mismatches)

## Ignore
- Style issues (TypeScript formatting)
- OpenAPI spec itself (docs/*, openapi.yaml are documentation)
- Test helper code that intentionally doesn't call Claude CLI
- Deprecated exports already removed
