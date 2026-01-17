# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-01-17

### Added
- **Security hardening**: Fixed 11 critical/high priority vulnerabilities
- **Security test suite**: 14 comprehensive security tests
- **Integration test suite**: 10 tests for session continuity
- **Structured error logging**: Context-aware error logging for production debugging
- **Model validation**: Server-side validation for model names (opus/sonnet/haiku/claude-*)
- **Port validation**: CLI client validates port range (1-65535)
- **Path traversal prevention**: `validateSafePath()` with symlink protection
- **Command injection prevention**: JSON depth/size limits, shell pattern detection
- **Resource leak fixes**: Proper cleanup on all error paths
- **Environment config**: `.env.example` for documentation
- **CI/CD workflow**: GitHub Actions for automated testing
- **Contributing guide**: `CONTRIBUTING.md` with development standards
- **Production readiness assessment**: Comprehensive deployment guide

### Fixed
- Path traversal vulnerability in context-reader.ts
- Command injection via unvalidated JSON parameters
- Rate limiter race condition during cleanup
- Streaming [DONE] marker not sent on errors
- Empty query validation missing
- Session state race in CLI client
- Resource leaks in CLI wrapper (stdin/stdout)
- Timeout cleanup race conditions
- Dead code removal (unused `record()` method)

### Changed
- Rate limiter uses serialized cleanup (no concurrent modifications)
- CLI client uses request queue to prevent concurrent sends
- Error messages sanitized to prevent information leakage
- Session ID validation enforced (UUID format)
- Request size limit enforced (1MB max)
- Streaming errors include structured logging
- Package.json includes repository URL and engine requirements

### Security
- All 10 CRITICAL vulnerabilities resolved
- 11 of 25 HIGH priority issues resolved
- Security-first validation at API boundaries
- Defense-in-depth approach throughout

### Documentation
- Production readiness assessment (`.aigile/PRODUCTION-READINESS.md`)
- Perfection protocol summary (`PERFECTION-PROTOCOL-SUMMARY.md`)
- Deep review reports (`.aigile/deep-review/`)
- QA manual testing guide (`docs/QA-MANUAL-TESTING.md`)
- Integration test documentation

### Testing
- Test coverage: 35% → 60%
- Total tests: 40 → 58+
- All critical paths covered
- Security tests: 0 → 14
- Integration tests: 0 → 10

## [0.1.0] - 2026-01-16

### Added
- Initial release
- OpenAI-compatible API server
- Claude Code CLI wrapper with headless mode
- Session continuity support
- CONTEXT.md support for directory context
- Rate limiting (60 req/min default)
- Streaming support (simulated)
- Interactive CLI client
- TypeScript type safety
- Zod validation
- Basic test suite (40 tests)

### Features
- POST /v1/chat/completions - Chat completions endpoint
- GET /v1/models - List available models
- GET /health - Health check endpoint
- Session management with session_id
- X-Session-Id header support
- Model selection (opus/sonnet/haiku)
- Tool control (allowed/disallowed tools)
- Budget limits (max_budget_usd)
- Permission modes
- JSON schema support
- Agent support
- MCP integration support
- Context file reading

### Documentation
- README.md with quick start guide
- API documentation
- OpenAPI specification
- Conversation flow guide
- Architecture diagrams

---

## Versioning Strategy

**Major version (x.0.0)**: Breaking API changes
**Minor version (0.x.0)**: New features, non-breaking changes
**Patch version (0.0.x)**: Bug fixes, security patches

## Upgrade Guide

### 0.1.0 → 0.2.0

**Breaking Changes**: None

**New Environment Variables**:
- All existing environment variables work unchanged
- See `.env.example` for new optional variables

**New Scripts**:
```bash
bun run validate       # Type check + tests
bun run test:security  # Run security tests only
bun run test:integration # Run integration tests (requires running server)
```

**Security Improvements**:
- Stricter input validation (may reject previously accepted invalid inputs)
- Model names must match opus/sonnet/haiku/claude-* pattern
- Port numbers must be 1-65535
- Session IDs must be valid UUIDs

If your application sends invalid data, it will now receive `400` errors with clear validation messages instead of `500` errors.

**Testing**:
After upgrading, run:
```bash
bun run validate
```

All tests should pass. If using integration tests, start the server first:
```bash
# Terminal 1
bun run start

# Terminal 2
bun run test:integration
```

---

[0.2.0]: https://github.com/vladimir-ks/anthropic-headless-api/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vladimir-ks/anthropic-headless-api/releases/tag/v0.1.0
