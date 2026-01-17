# Project Context

## Architecture

anthropic-headless-api is an OpenAI-compatible API server that wraps Claude Code CLI for headless operation. It provides session continuity, CONTEXT.md support, and rate limiting for any OpenAI-compatible client.

## Key Conventions

- **Security-first design**: All inputs validated, path traversal prevented, injection attacks blocked
- **Resource cleanup**: All async operations have try-catch-finally with cleanup
- **Structured logging**: Error logs include context (path, method, session, model)
- **Process naming**: `process.title = 'anthropic-headless-api'` for monitoring
- **Intentional console.log**: Used for structured logging and CLI output (not debug code)

## Previous Fixes Applied

**Session 1 (85bdbea)**: Fixed 7 CRITICAL vulnerabilities
- Path traversal prevention (`validateSafePath()`)
- Command injection prevention (`validateJSONForCLI()`)
- Rate limiter race condition (cleanup serialization)
- Streaming [DONE] marker (always sent)
- Empty query validation
- Session state race (request serialization)
- Security test suite added

**Session 2 (b484a4a)**: Fixed 4 HIGH priority issues
- Resource leaks (process cleanup on all paths)
- Port injection (1-65535 validation)
- Model validation (regex pattern)
- Dead code removal

**Session 3 (6fc252b)**: Infrastructure improvements
- Structured error logging
- CI/CD workflow
- Environment documentation
- Contributing guide

## Review Focus

This is a **FINAL VERIFICATION** review after all fixes. Focus on:

1. **Security vulnerabilities** - Any remaining exploits?
2. **Resource leaks** - Any missed cleanup paths?
3. **Logic errors** - Any edge cases or bugs?
4. **Edge case gaps** - Boundary conditions handled?
5. **Error handling** - Proper try-catch coverage?
6. **Performance issues** - Any inefficiencies?
7. **Test coverage** - Critical paths covered?
8. **Dead code** - Any unused code?
9. **Concurrency issues** - Race conditions?
10. **API contract violations** - OpenAI compatibility?

## Ignore

- Style issues (TypeScript enforces formatting)
- Previous review findings (already fixed)
- Integration test files (require running server)
- Documentation files (.md, .yml)

## Success Criteria

- Zero CRITICAL issues
- Zero HIGH priority issues
- MEDIUM/LOW issues documented for future sprints
- Confirm production-ready status
