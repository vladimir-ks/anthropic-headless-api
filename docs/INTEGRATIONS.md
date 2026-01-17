---
metadata:
  modules: [anthropic-headless-api, integrations]
  tldr: "How to integrate anthropic-headless-api with OpenCode, LiteLLM, Cursor, Continue.dev, and other tools"
  dependencies: [API.md, USAGE-GUIDE.md]
  code_refs: []
---

# Integration Guide

This document explains how to use anthropic-headless-api with various AI coding tools.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         YOUR MACHINE                                 │
│                                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐    │
│  │  OpenCode  │  │   Cursor   │  │ Continue   │  │   Aider    │    │
│  │            │  │            │  │   .dev     │  │            │    │
│  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘  └─────┬──────┘    │
│        │               │               │               │            │
│        └───────────────┴───────────────┴───────────────┘            │
│                                │                                     │
│                    OpenAI-compatible API                            │
│                                │                                     │
│                    ┌───────────▼───────────┐                        │
│                    │ anthropic-headless-api │                        │
│                    │   localhost:3456       │                        │
│                    └───────────┬───────────┘                        │
│                                │                                     │
│                    ┌───────────▼───────────┐                        │
│                    │   Claude Code CLI      │                        │
│                    │   (your subscription)  │                        │
│                    └───────────┬───────────┘                        │
│                                │                                     │
└────────────────────────────────│─────────────────────────────────────┘
                                 │
                                 ▼
                         ┌──────────────┐
                         │  Anthropic   │
                         │    API       │
                         └──────────────┘
```

---

## OpenCode Integration

[OpenCode](https://github.com/opencoders/opencode) is an open-source AI coding assistant.

### Configuration

Create or edit `~/.config/opencode/config.json`:

```json
{
  "providers": {
    "anthropic-local": {
      "type": "openai",
      "baseUrl": "http://localhost:3456/v1",
      "apiKey": "not-needed",
      "models": {
        "claude-code-cli": {
          "contextWindow": 200000,
          "maxOutput": 64000
        }
      }
    }
  },
  "defaultProvider": "anthropic-local",
  "defaultModel": "claude-code-cli"
}
```

### Usage

```bash
# Start the API server
bun run start

# In another terminal, run OpenCode
opencode
```

### Model Selection

To use a specific model:

```json
{
  "providers": {
    "anthropic-opus": {
      "type": "openai",
      "baseUrl": "http://localhost:3456/v1",
      "apiKey": "not-needed",
      "defaultHeaders": {
        "X-Model": "opus"
      }
    }
  }
}
```

---

## LiteLLM Integration

[LiteLLM](https://github.com/BerriAI/litellm) is a unified API for 100+ LLMs.

### Configuration

Add to your LiteLLM config:

```yaml
model_list:
  - model_name: claude-local
    litellm_params:
      model: openai/claude-code-cli
      api_base: http://localhost:3456/v1
      api_key: not-needed

  - model_name: claude-opus-local
    litellm_params:
      model: openai/claude-code-cli
      api_base: http://localhost:3456/v1
      api_key: not-needed
      extra_body:
        model: opus
```

### Python Usage

```python
import litellm

# Using LiteLLM
response = litellm.completion(
    model="claude-local",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)

# With session continuity
response1 = litellm.completion(
    model="claude-local",
    messages=[{"role": "user", "content": "Remember X"}]
)
session_id = response1.get("session_id")

response2 = litellm.completion(
    model="claude-local",
    messages=[{"role": "user", "content": "What was X?"}],
    extra_body={"session_id": session_id}
)
```

---

## Continue.dev Integration

[Continue](https://continue.dev) is an open-source AI code assistant for VS Code and JetBrains.

### Configuration

Edit `~/.continue/config.json`:

```json
{
  "models": [
    {
      "title": "Claude (Local)",
      "provider": "openai",
      "model": "claude-code-cli",
      "apiBase": "http://localhost:3456/v1",
      "apiKey": "not-needed"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Claude Haiku (Local)",
    "provider": "openai",
    "model": "claude-code-cli",
    "apiBase": "http://localhost:3456/v1",
    "apiKey": "not-needed"
  }
}
```

### Multiple Models

```json
{
  "models": [
    {
      "title": "Claude Opus (Complex)",
      "provider": "openai",
      "model": "claude-code-cli",
      "apiBase": "http://localhost:3456/v1",
      "apiKey": "not-needed",
      "requestOptions": {
        "extraBodyProperties": {
          "model": "opus"
        }
      }
    },
    {
      "title": "Claude Sonnet (Fast)",
      "provider": "openai",
      "model": "claude-code-cli",
      "apiBase": "http://localhost:3456/v1",
      "apiKey": "not-needed",
      "requestOptions": {
        "extraBodyProperties": {
          "model": "sonnet"
        }
      }
    }
  ]
}
```

---

## Cursor Integration

[Cursor](https://cursor.sh) is an AI-powered code editor.

### Configuration

Cursor doesn't directly support custom OpenAI endpoints, but you can use it with a proxy:

1. **Start the API server**
   ```bash
   HOST=0.0.0.0 bun run start
   ```

2. **Configure environment**
   ```bash
   export OPENAI_API_BASE=http://localhost:3456/v1
   export OPENAI_API_KEY=not-needed
   ```

3. **Or use ngrok for remote access**
   ```bash
   ngrok http 3456
   # Use the ngrok URL in Cursor's settings
   ```

---

## Aider Integration

[Aider](https://aider.chat) is an AI pair programming tool.

### Configuration

```bash
# Set environment variables
export OPENAI_API_BASE=http://localhost:3456/v1
export OPENAI_API_KEY=not-needed

# Run aider
aider --model claude-code-cli
```

### With Model Selection

```bash
# Using .aider.conf.yml
cat > .aider.conf.yml << EOF
openai-api-base: http://localhost:3456/v1
openai-api-key: not-needed
model: claude-code-cli
EOF

aider
```

---

## Cline (VS Code) Integration

[Cline](https://github.com/clinebot/cline) is a VS Code extension for AI coding.

### Configuration

In VS Code settings:

```json
{
  "cline.apiProvider": "openai",
  "cline.openaiBaseUrl": "http://localhost:3456/v1",
  "cline.openaiApiKey": "not-needed",
  "cline.openaiModelId": "claude-code-cli"
}
```

---

## Custom Python Client

### Basic Client

```python
import requests
from typing import Optional

class ClaudeAPIClient:
    def __init__(self, base_url: str = "http://localhost:3456"):
        self.base_url = base_url
        self.session_id: Optional[str] = None

    def chat(
        self,
        message: str,
        model: str = None,
        system: str = None,
        working_directory: str = None,
        **kwargs
    ) -> dict:
        body = {
            "messages": [{"role": "user", "content": message}],
            **kwargs
        }

        if self.session_id:
            body["session_id"] = self.session_id
        if model:
            body["model"] = model
        if system and not self.session_id:
            body["messages"].insert(0, {"role": "system", "content": system})
        if working_directory:
            body["working_directory"] = working_directory

        response = requests.post(
            f"{self.base_url}/v1/chat/completions",
            json=body
        )
        data = response.json()

        if "error" in data:
            raise Exception(data["error"]["message"])

        self.session_id = data.get("session_id")
        return data

    def reset(self):
        """Start new conversation"""
        self.session_id = None

# Usage
client = ClaudeAPIClient()

# Simple chat
response = client.chat("Hello!")
print(response["choices"][0]["message"]["content"])

# With model selection
response = client.chat("Complex question", model="opus")

# With structured output
response = client.chat(
    "Extract the person's name and age",
    json_schema={
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "age": {"type": "integer"}
        },
        "required": ["name", "age"]
    }
)

# With custom agent
response = client.chat(
    "Review this code",
    agent="Explore",
    allowed_tools=["Read", "Grep", "Glob"]
)

# With budget control
response = client.chat(
    "Analyze this codebase",
    max_budget_usd=0.50
)
```

### Async Client

```python
import aiohttp
import asyncio

class AsyncClaudeClient:
    def __init__(self, base_url: str = "http://localhost:3456"):
        self.base_url = base_url
        self.session_id = None

    async def chat(self, message: str, **kwargs) -> dict:
        body = {
            "messages": [{"role": "user", "content": message}],
            **kwargs
        }
        if self.session_id:
            body["session_id"] = self.session_id

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/v1/chat/completions",
                json=body
            ) as response:
                data = await response.json()
                self.session_id = data.get("session_id")
                return data

# Usage
async def main():
    client = AsyncClaudeClient()
    response = await client.chat("Hello!")
    print(response["choices"][0]["message"]["content"])

asyncio.run(main())
```

---

## Custom JavaScript/TypeScript Client

### Node.js / Bun

```typescript
interface ChatOptions {
  model?: string;
  system?: string;
  working_directory?: string;
  json_schema?: Record<string, unknown>;
  allowed_tools?: string[];
  max_budget_usd?: number;
  [key: string]: unknown;
}

class ClaudeClient {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl = "http://localhost:3456") {
    this.baseUrl = baseUrl;
  }

  async chat(message: string, options: ChatOptions = {}): Promise<any> {
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: message }],
      ...options,
    };

    if (this.sessionId) {
      body.session_id = this.sessionId;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    this.sessionId = data.session_id;
    return data;
  }

  reset(): void {
    this.sessionId = null;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }
}

// Usage
const client = new ClaudeClient();

// Basic chat
const response = await client.chat("Hello!");

// With options
const structured = await client.chat("Extract data", {
  model: "opus",
  json_schema: {
    type: "object",
    properties: { items: { type: "array" } },
  },
});

// Code review with specific agent
const review = await client.chat("Review this file", {
  agent: "Explore",
  allowed_tools: ["Read", "Grep"],
  working_directory: "/path/to/project",
});
```

---

## cURL Examples

### Basic Request

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### With Model Selection

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "opus",
    "messages": [{"role": "user", "content": "Complex analysis"}]
  }'
```

### With Structured Output

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Extract name and age from: John is 30"}],
    "json_schema": {
      "type": "object",
      "properties": {
        "name": {"type": "string"},
        "age": {"type": "integer"}
      },
      "required": ["name", "age"]
    }
  }'
```

### With Tool Restrictions

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Search the codebase"}],
    "tools": ["Read", "Grep", "Glob"],
    "disallowed_tools": ["Write", "Edit", "Bash"]
  }'
```

### With Custom Agent

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Review this code"}],
    "agents": {
      "reviewer": {
        "description": "Code review specialist",
        "prompt": "You are a senior code reviewer. Focus on security and performance."
      }
    },
    "agent": "reviewer"
  }'
```

### Session Continuity

```bash
# First request
RESPONSE=$(curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Remember: secret=42"}]}')

SESSION=$(echo $RESPONSE | jq -r '.session_id')

# Continue conversation
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION\",
    \"messages\": [{\"role\": \"user\", \"content\": \"What was the secret?\"}]
  }"
```

### Ephemeral Session (No Persistence)

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "One-off question"}],
    "ephemeral": true
  }'
```

### With Budget Control

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Analyze this large codebase"}],
    "max_budget_usd": 0.50,
    "fallback_model": "haiku"
  }'
```

### With MCP Server

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Query the database"}],
    "mcp_config": ["{\"mcpServers\":{\"postgres\":{\"command\":\"npx\",\"args\":[\"-y\",\"@modelcontextprotocol/server-postgres\"]}}}"]
  }'
```

---

## Feature Comparison

| Feature | OpenCode | LiteLLM | Continue | Cursor | Aider |
|---------|----------|---------|----------|--------|-------|
| Model selection | Via headers | Via extra_body | Via extraBodyProperties | Limited | Via env |
| Session continuity | Full | Via extra_body | Limited | No | No |
| Structured output | Via body | Via extra_body | Limited | No | No |
| Tool restrictions | Via body | Via extra_body | No | No | No |
| Custom agents | Via body | Via extra_body | No | No | No |
| Working directory | Via body | Via extra_body | Native | Native | Native |
| Budget control | Via body | Via extra_body | No | No | No |

---

## Troubleshooting

### Connection Refused

```bash
# Check if server is running
curl http://localhost:3456/health

# Start server if not running
bun run start
```

### Rate Limited

```bash
# Increase rate limit
RATE_LIMIT_MAX=120 bun run start

# Or disable
RATE_LIMIT_ENABLED=false bun run start
```

### Model Not Found

The API always uses Claude Code CLI - the `model` field selects which Claude model the CLI uses:
- `opus` - Claude Opus 4.5
- `sonnet` - Claude Sonnet 4.5
- `haiku` - Claude Haiku 4.5

### Session Expired

Sessions are stored by Claude Code CLI. If a session expires:
1. Start a new conversation (omit `session_id`)
2. Or use `continue_conversation: true` to continue the most recent

### Tool Permissions

If tools aren't executing, check:
1. `permission_mode` - try `acceptEdits` or `bypassPermissions`
2. `allowed_tools` - ensure needed tools are listed
3. Working directory trust - Claude Code may need to trust the directory
