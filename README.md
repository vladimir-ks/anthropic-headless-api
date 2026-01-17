# anthropic-headless-api

OpenAI-compatible API server wrapping Claude Code CLI with session continuity.

**Status: MVP (~40% of Claude CLI capabilities)**

## Overview

This server bridges any OpenAI-compatible client (OpenCode, LiteLLM, etc.) to your Claude Code CLI subscription. Key difference from OpenAI API: **stateful sessions** - Claude maintains conversation context internally.

```
┌──────────────┐     ┌─────────────────────┐     ┌──────────────────┐
│ OpenCode/    │────▶│ anthropic-headless- │────▶│ Claude Code CLI  │
│ Any Client   │     │ api (this server)   │     │ (-p mode)        │
└──────────────┘     └─────────────────────┘     └────────┬─────────┘
                              │                           │
                       reads CONTEXT.md                   │
                       from working dir                   ▼
                                                  ┌──────────────┐
                                                  │  Anthropic   │
                                                  │ (via your    │
                                                  │ subscription)│
                                                  └──────────────┘
```

## Why This Exists

1. **Use your Claude Code subscription** with any tool
2. **Session continuity** - no need to resend conversation history
3. **CONTEXT.md support** - like CLAUDE.md, but for any use case
4. **OpenAI-compatible** - works with OpenCode, LiteLLM, and 100+ tools
5. **Rate limiting** - protects against accidental request floods

## Quick Start

```bash
# Install dependencies
bun install

# Start the server
bun run start

# Or with custom port
PORT=8080 bun run start

# Or with specific Claude config directory
CLAUDE_CONFIG_DIR=~/.claude-inst7 bun run start
```

## Session Continuity

Unlike OpenAI's stateless API, this server maintains conversation state:

```bash
# First request - start conversation
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Remember the number 42"}]}'

# Response includes session_id
# {"session_id":"abc123-...", "choices":[...]}

# Continue conversation - Claude remembers context
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"session_id":"abc123-...","messages":[{"role":"user","content":"What number?"}]}'

# Claude responds with "42" - it remembers!
```

See [docs/CONVERSATION-FLOW.md](docs/CONVERSATION-FLOW.md) for detailed examples.

## API Endpoints

### POST /v1/chat/completions

OpenAI-compatible chat completions with session support.

**New conversation:**
```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "Hello!"}
  ]
}
```

**Continue conversation:**
```json
{
  "session_id": "abc123-def4-5678-90ab-cdef12345678",
  "messages": [
    {"role": "user", "content": "What did we discuss?"}
  ]
}
```

**Response:**
```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "model": "claude-code-cli",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "Hello! How can I help?"},
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 10,
    "completion_tokens": 5,
    "total_tokens": 15,
    "cache_read_tokens": 0,
    "cache_creation_tokens": 0
  },
  "session_id": "abc123-def4-5678-90ab-cdef12345678",
  "claude_metadata": {
    "totalCostUsd": 0.001,
    "durationMs": 1500
  }
}
```

### GET /v1/models

List available models (returns `claude-code-cli`).

### GET /health

Health check with uptime and version info.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `127.0.0.1` | Server host |
| `CLAUDE_CONFIG_DIR` | (none) | Claude config directory |
| `DEFAULT_SYSTEM_PROMPT` | (none) | Default system prompt |
| `CONTEXT_FILENAME` | `CONTEXT.md` | Context file to read |
| `ENABLE_CORS` | `true` | Enable CORS headers |
| `LOG_LEVEL` | `info` | debug/info/warn/error |
| `RATE_LIMIT_MAX` | `60` | Max requests per minute |
| `RATE_LIMIT_ENABLED` | `true` | Enable rate limiting |

## CONTEXT.md Support

On new conversations, the server reads `CONTEXT.md` from the working directory:

```markdown
# Patient: John Doe

## Demographics
- Age: 45
- Gender: Male

## Current Conditions
- Hypertension (diagnosed 2020)
- Type 2 Diabetes (diagnosed 2022)
```

## OpenAPI Specification

Full API spec available at [openapi.yaml](openapi.yaml).

## Architecture

```
src/
├── index.ts              # Server entry point, graceful shutdown
├── types/
│   ├── api.ts            # OpenAI-compatible types
│   └── claude.ts         # Claude CLI output types
├── lib/
│   ├── claude-cli.ts     # CLI wrapper with JSON output
│   └── context-reader.ts # CONTEXT.md reader
├── middleware/
│   └── rate-limiter.ts   # Sliding window rate limiting
├── routes/
│   └── chat.ts           # Chat completions handler
└── validation/
    └── schemas.ts        # Zod request validation
```

## Development

```bash
# Run in watch mode
bun run dev

# Type check
bun run typecheck

# Run tests
bun test
```

## Documentation

- [CONVERSATION-FLOW.md](docs/CONVERSATION-FLOW.md) - Session continuity guide
- [API.md](docs/API.md) - API reference
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) - System design
- [openapi.yaml](openapi.yaml) - OpenAPI specification

## License

MIT
