---
metadata:
  modules: [anthropic-headless-api]
  tldr: "Complete usage guide with all flags, current status, and examples"
  dependencies: [CLAUDE-CLI-REFERENCE.md]
  code_refs: [src/]
---

# Usage Guide

## Completion Status

### Implemented (Working)

| Feature | API Field | CLI Flag | Status |
|---------|-----------|----------|--------|
| Session continuity | `session_id` | `--resume` | Working |
| System prompt | `system` | `--system-prompt` | Working |
| Working directory | `working_directory` | cwd | Working |
| CONTEXT.md reading | automatic | - | Working |
| JSON output parsing | automatic | `--output-format json` | Working |
| Rate limiting | - | - | Working (60/min) |
| Graceful shutdown | - | - | Working |
| Request validation | - | Zod schemas | Working |
| Rich metadata | `claude_metadata` | - | Working |

### NOT Implemented (Gaps)

| Feature | API Field | CLI Flag | Priority |
|---------|-----------|----------|----------|
| Model selection | `model` | `--model` | HIGH |
| Tool restrictions | `allowed_tools` | `--allowedTools` | HIGH |
| Budget control | `max_budget_usd` | `--max-budget-usd` | HIGH |
| Real streaming | - | `--output-format stream-json` | MEDIUM |
| Output schema | `output_schema` | `--json-schema` | MEDIUM |
| Permission mode | `permission_mode` | `--permission-mode` | MEDIUM |
| Append system prompt | `append_system_prompt` | `--append-system-prompt` | LOW |
| Custom agents | `agents` | `--agents` | LOW |
| Fallback model | `fallback_model` | `--fallback-model` | LOW |
| Additional dirs | `add_dirs` | `--add-dir` | LOW |
| MCP config | `mcp_config` | `--mcp-config` | LOW |
| Fork session | `fork_session` | `--fork-session` | LOW |
| No persistence | `ephemeral` | `--no-session-persistence` | LOW |
| Tool disallow | `disallowed_tools` | `--disallowedTools` | LOW |

**Current coverage: ~40% of Claude CLI capabilities**

---

## Installation

```bash
# Clone or navigate to project
cd ~/path/to/anthropic-headless-api

# Install dependencies
bun install

# Verify Claude CLI is available
claude --version
```

## Starting the Server

### Basic Start

```bash
bun run start
```

### With Environment Variables

```bash
# Custom port
PORT=8080 bun run start

# Custom Claude config directory
CLAUDE_CONFIG_DIR=~/.claude-medical bun run start

# Debug logging
LOG_LEVEL=debug bun run start

# Disable rate limiting
RATE_LIMIT_ENABLED=false bun run start

# Custom rate limit
RATE_LIMIT_MAX=120 bun run start

# All options combined
PORT=3456 \
HOST=0.0.0.0 \
CLAUDE_CONFIG_DIR=~/.claude-inst7 \
DEFAULT_SYSTEM_PROMPT="You are a helpful assistant" \
CONTEXT_FILENAME=CONTEXT.md \
ENABLE_CORS=true \
LOG_LEVEL=info \
RATE_LIMIT_MAX=60 \
RATE_LIMIT_ENABLED=true \
bun run start
```

### As Background Daemon

```bash
# Using nohup
nohup bun run start > /var/log/anthropic-headless-api.log 2>&1 &

# Using pm2 (if installed)
pm2 start "bun run start" --name anthropic-headless-api

# Check it's running
curl http://localhost:3456/health
```

---

## Server Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | Server port |
| `HOST` | `127.0.0.1` | Server host (use 0.0.0.0 for external) |
| `CLAUDE_CONFIG_DIR` | system default | Claude config directory |
| `DEFAULT_SYSTEM_PROMPT` | empty | Default system prompt for new sessions |
| `CONTEXT_FILENAME` | `CONTEXT.md` | Context file to read from working_directory |
| `ENABLE_CORS` | `true` | Enable CORS headers |
| `LOG_LEVEL` | `info` | Logging: debug, info, warn, error |
| `RATE_LIMIT_MAX` | `60` | Max requests per minute |
| `RATE_LIMIT_ENABLED` | `true` | Enable/disable rate limiting |

---

## API Reference

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check (bypasses rate limit) |
| GET | `/` | Same as /health |
| GET | `/v1/models` | List available models |
| POST | `/v1/chat/completions` | Chat completion |

### Health Check

```bash
curl http://localhost:3456/health
```

Response:
```json
{
  "status": "ok",
  "version": "0.2.0",
  "backend": "claude-code-cli",
  "claude_version": "2.1.6 (Claude Code)",
  "uptime_seconds": 123
}
```

### List Models

```bash
curl http://localhost:3456/v1/models
```

Response:
```json
{
  "object": "list",
  "data": [{
    "id": "claude-code-cli",
    "object": "model",
    "created": 1705430400,
    "owned_by": "anthropic"
  }]
}
```

### Chat Completion

#### New Conversation

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "system", "content": "You are a helpful assistant."},
      {"role": "user", "content": "Hello, who are you?"}
    ]
  }'
```

#### Continue Conversation

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "session_id": "abc123-from-previous-response",
    "messages": [
      {"role": "user", "content": "What did we just discuss?"}
    ]
  }'
```

#### Using X-Session-Id Header

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: abc123-from-previous-response" \
  -d '{
    "messages": [
      {"role": "user", "content": "Continue our conversation"}
    ]
  }'
```

#### With Working Directory (CONTEXT.md)

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "working_directory": "/path/to/project",
    "messages": [
      {"role": "user", "content": "What is this project about?"}
    ]
  }'
```

#### Streaming Response

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "stream": true,
    "messages": [
      {"role": "user", "content": "Tell me a story"}
    ]
  }'
```

---

## Request Body Reference

### Currently Supported Fields

```typescript
{
  // Required
  "messages": [
    {"role": "system", "content": "..."},  // Optional system message
    {"role": "user", "content": "..."},    // At least one required
    {"role": "assistant", "content": "..."} // For context
  ],

  // Optional
  "session_id": "uuid",           // Continue existing session
  "system": "string",             // Override system prompt
  "working_directory": "/path",   // For CONTEXT.md reading
  "stream": false                 // Enable SSE streaming
}
```

### Fields Accepted but NOT Used

```typescript
{
  "model": "ignored",        // Always uses Claude Code CLI default
  "max_tokens": 0,           // Not passed to CLI
  "temperature": 0,          // Not passed to CLI
  "context_files": []        // Not implemented
}
```

---

## Response Body Reference

### Non-Streaming Response

```json
{
  "id": "chatcmpl-1705430400000-abc123",
  "object": "chat.completion",
  "created": 1705430400,
  "model": "claude-code-cli",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Response text here"
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 100,
    "completion_tokens": 50,
    "total_tokens": 150,
    "cache_read_tokens": 80,
    "cache_creation_tokens": 20
  },
  "session_id": "abc123-def4-5678-90ab-cdef12345678",
  "claude_metadata": {
    "durationMs": 2500,
    "durationApiMs": 3000,
    "numTurns": 1,
    "totalCostUsd": 0.015,
    "usage": {
      "inputTokens": 100,
      "outputTokens": 50,
      "cacheCreationTokens": 20,
      "cacheReadTokens": 80
    },
    "modelUsage": {
      "claude-opus-4-5-20251101": {
        "inputTokens": 100,
        "outputTokens": 50,
        "costUSD": 0.015
      }
    },
    "uuid": "unique-execution-id"
  }
}
```

### Streaming Response (SSE)

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705430400,"model":"claude-code-cli","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705430400,"model":"claude-code-cli","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","created":1705430400,"model":"claude-code-cli","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"session_id":"abc123"}

data: [DONE]
```

---

## Error Responses

### Validation Error (400)

```json
{
  "error": {
    "message": "At least one user message is required",
    "type": "invalid_request_error",
    "code": "validation_error",
    "details": {
      "errors": [
        {"field": "messages", "message": "At least one user message is required"}
      ]
    }
  }
}
```

### Rate Limited (429)

```json
{
  "error": {
    "message": "Too many requests. Please slow down.",
    "type": "rate_limit_error",
    "code": "rate_limited",
    "details": {
      "retry_after": 30
    }
  }
}
```

Headers included:
- `X-RateLimit-Limit: 60`
- `X-RateLimit-Remaining: 0`
- `X-RateLimit-Reset: 1705430460`
- `Retry-After: 30`

### Server Error (500)

```json
{
  "error": {
    "message": "Claude CLI execution failed",
    "type": "server_error",
    "code": "claude_cli_error",
    "details": {
      "sessionId": "abc123"
    }
  }
}
```

---

## Integration Examples

### Python

```python
import requests

BASE_URL = "http://localhost:3456"

class ClaudeClient:
    def __init__(self):
        self.session_id = None

    def chat(self, message, system=None):
        body = {
            "messages": [{"role": "user", "content": message}]
        }
        if self.session_id:
            body["session_id"] = self.session_id
        if system and not self.session_id:
            body["messages"].insert(0, {"role": "system", "content": system})

        response = requests.post(f"{BASE_URL}/v1/chat/completions", json=body)
        data = response.json()

        if "error" in data:
            raise Exception(data["error"]["message"])

        self.session_id = data.get("session_id")
        return data["choices"][0]["message"]["content"]

    def reset(self):
        self.session_id = None

# Usage
client = ClaudeClient()
print(client.chat("Hello!", system="Be concise"))
print(client.chat("What did I just say?"))  # Continues session
```

### JavaScript/TypeScript

```typescript
const BASE_URL = "http://localhost:3456";

class ClaudeClient {
  private sessionId: string | null = null;

  async chat(message: string, system?: string): Promise<string> {
    const body: any = {
      messages: [{ role: "user", content: message }]
    };

    if (this.sessionId) {
      body.session_id = this.sessionId;
    }
    if (system && !this.sessionId) {
      body.messages.unshift({ role: "system", content: system });
    }

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    this.sessionId = data.session_id;
    return data.choices[0].message.content;
  }

  reset(): void {
    this.sessionId = null;
  }
}
```

### cURL Script

```bash
#!/bin/bash
BASE_URL="http://localhost:3456"
SESSION_ID=""

chat() {
  local message="$1"
  local body

  if [ -n "$SESSION_ID" ]; then
    body=$(jq -n --arg msg "$message" --arg sid "$SESSION_ID" \
      '{session_id: $sid, messages: [{role: "user", content: $msg}]}')
  else
    body=$(jq -n --arg msg "$message" \
      '{messages: [{role: "user", content: $msg}]}')
  fi

  response=$(curl -s -X POST "$BASE_URL/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$body")

  SESSION_ID=$(echo "$response" | jq -r '.session_id // empty')
  echo "$response" | jq -r '.choices[0].message.content'
}

# Usage
chat "Hello, remember my name is Alice"
chat "What is my name?"
```

---

## Using with CONTEXT.md

Create a `CONTEXT.md` file in your working directory:

```markdown
# Project Context

## Overview
This is a medical records application.

## Key Files
- src/patient.ts - Patient data model
- src/records.ts - Record management

## Constraints
- All patient data must be encrypted
- HIPAA compliance required
```

Then reference it:

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "working_directory": "/path/to/project",
    "messages": [
      {"role": "user", "content": "What compliance requirements apply?"}
    ]
  }'
```

Claude will see the CONTEXT.md content automatically.

---

## Monitoring

### Check Server Health

```bash
curl http://localhost:3456/health | jq
```

### View Logs

```bash
# If running with LOG_LEVEL=debug
LOG_LEVEL=debug bun run start

# Output includes:
# [anthropic-headless-api] [DEBUG] 2024-01-16T... POST /v1/chat/completions
# [anthropic-headless-api] [INFO] 2024-01-16T... Chat completion: 2 messages, session=new
# [anthropic-headless-api] [INFO] 2024-01-16T... Completed: session=abc123, cost=$0.0150
```

### Monitor Rate Limits

Check response headers:
```bash
curl -i http://localhost:3456/v1/models

# Headers show:
# X-RateLimit-Limit: 60
# X-RateLimit-Remaining: 59
# X-RateLimit-Reset: 1705430460
```

---

## Troubleshooting

### "Claude Code CLI not found"

```bash
# Verify claude is installed
which claude
claude --version

# If not found, install Claude Code CLI
# See: https://claude.ai/code
```

### "Rate limited" errors

```bash
# Increase rate limit
RATE_LIMIT_MAX=120 bun run start

# Or disable rate limiting (not recommended)
RATE_LIMIT_ENABLED=false bun run start
```

### Session not continuing

Ensure you're passing `session_id` from the previous response:

```bash
# Get session_id from response
RESPONSE=$(curl -s -X POST ... )
SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')

# Use in next request
curl -X POST ... -d "{\"session_id\": \"$SESSION_ID\", ...}"
```

### CONTEXT.md not being read

- Only read for NEW sessions (not resumed)
- Check `working_directory` path is correct
- Check file is named exactly `CONTEXT.md` (or your CONTEXT_FILENAME)
- Check file permissions

---

## Next Steps for Full Completion

To reach 100% coverage, these features need implementation:

1. **Model selection** - Add `--model` flag passthrough
2. **Tool restrictions** - Add `--allowedTools` and `--disallowedTools`
3. **Budget control** - Add `--max-budget-usd`
4. **Real streaming** - Use `--output-format stream-json`
5. **Output schema** - Add `--json-schema`
6. **Permission modes** - Add `--permission-mode`

See `docs/CLAUDE-CLI-REFERENCE.md` for complete flag documentation.
