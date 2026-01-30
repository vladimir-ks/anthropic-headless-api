# Project Context

## Architecture
OpenAI-compatible API server wrapping Claude Code CLI with session continuity. Multi-backend routing (Claude CLI, OpenRouter, Gemini, Anthropic API, OpenAI). Includes auth-pool module for subscription management.

## Key Conventions
- Bun runtime (not Node.js)
- Zod for validation
- Structured logging via createModuleLogger
- Path validation prevents directory traversal
- Array bounds enforced (100 files, 50 tools, 20 dirs)

## Review Focus
- Security vulnerabilities (injection, path traversal, auth bypass)
- Resource leaks (memory, file handles, connections)
- Logic errors and race conditions
- Missing error handling
- Untyped `any` usage
- Dead code / unused imports

## Ignore
- Style issues (no linter configured)
- Console.log in CLI (client.ts) - intentional user output
- Console in logger.ts - it IS the logger
- Test file failures (rate limiting expected)
