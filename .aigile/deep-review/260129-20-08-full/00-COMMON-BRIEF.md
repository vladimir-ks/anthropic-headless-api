# Project Context

## Architecture
OpenAI-compatible API server wrapping Claude Code CLI with session continuity. Bridges OpenAI-compatible clients to Claude Code CLI subscription. Features multi-backend AI gateway, auth pool system for account management, and SQLite-based logging.

## Key Conventions
- Bun runtime (>=1.0.0), TypeScript 5.x
- Zod v4 for validation
- OpenAI-compatible API responses
- Session-based state management (unlike stateless OpenAI API)
- Multi-backend adapters (Anthropic, OpenAI, Gemini, OpenRouter, Claude CLI)

## Review Focus
- Security vulnerabilities (injection, auth bypass, path traversal)
- Resource misutilization (memory leaks, unclosed handles)
- Logic errors in routing, session management, quota tracking
- Missing error handling
- Test coverage gaps
- Dead code
- Race conditions in concurrent operations
- Input validation completeness

## Ignore
- Style issues (linter handles)
- TypeScript strict mode warnings
- Generated/vendor code in node_modules
- Documentation formatting
