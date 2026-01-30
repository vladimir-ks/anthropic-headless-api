# Project Context

## Architecture
OpenAI-compatible API gateway that routes requests to Claude Code CLI or various API backends (Anthropic, OpenAI, Gemini, OpenRouter). Includes auth-pool for multi-subscription management, process pooling for CLI concurrency control, and intelligent routing.

## Key Conventions
- Bun runtime (not Node.js) - use Bun.spawn, Bun.serve
- All backends implement BackendAdapter interface
- Process pools manage Claude CLI concurrency (prevent resource exhaustion)
- MemoryStore has LRU eviction limits (100K entries max)
- JSON validation for CLI params uses defense-in-depth (8 layers)
- Path validation prevents traversal attacks

## Review Focus
- Security vulnerabilities (injection, traversal, auth bypass)
- Resource leaks (FD, memory, processes)
- Race conditions in concurrent code
- Missing error handling
- Logic errors in routing/allocation
- Test coverage gaps

## Ignore
- Style issues (linter handles these)
- Console.log in CLI client (intentional user output)
- Console.log in logger.ts (intentional logging infrastructure)
- TODO comment in logger.ts (documented Sentry placeholder)
- Unused export readContextFiles (documented for future use)
