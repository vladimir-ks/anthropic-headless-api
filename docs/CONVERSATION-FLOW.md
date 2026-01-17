---
metadata:
  modules: [anthropic-headless-api, session-management]
  tldr: "How conversation continuity works - different from OpenAI's stateless approach"
  dependencies: [API.md]
  code_refs: [src/routes/chat.ts, src/lib/claude-cli.ts]
---

# Conversation Flow Guide

## Key Difference from OpenAI API

| Aspect | OpenAI API | anthropic-headless-api |
|--------|-----------|------------------------|
| State | Stateless - client sends full history | Stateful - server maintains context |
| Messages | Send all messages every request | Send only new message + session_id |
| Context | Rebuilt from scratch each call | Preserved in Claude's memory |
| Token cost | Re-processes history each time | Only processes new content |

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    FIRST REQUEST                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client                         Server                Claude CLI │
│    │                              │                        │     │
│    │  POST /v1/chat/completions  │                        │     │
│    │  { messages: [...] }        │                        │     │
│    │─────────────────────────────▶│                        │     │
│    │                              │  claude -p "query"     │     │
│    │                              │────────────────────────▶│     │
│    │                              │                        │     │
│    │                              │  response + session_id │     │
│    │                              │◀────────────────────────│     │
│    │  { session_id: "abc123",    │                        │     │
│    │    choices: [...] }         │                        │     │
│    │◀─────────────────────────────│                        │     │
│    │                              │                        │     │
│  CLIENT STORES session_id        │                        │     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  SUBSEQUENT REQUESTS                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Client                         Server                Claude CLI │
│    │                              │                        │     │
│    │  POST /v1/chat/completions  │                        │     │
│    │  { session_id: "abc123",    │                        │     │
│    │    messages: [new msg] }    │                        │     │
│    │─────────────────────────────▶│                        │     │
│    │                              │  claude -p --resume    │     │
│    │                              │    abc123 "new query"  │     │
│    │                              │────────────────────────▶│     │
│    │                              │                        │     │
│    │                              │  Claude already knows  │     │
│    │                              │  the full context!     │     │
│    │                              │                        │     │
│    │                              │  response              │     │
│    │                              │◀────────────────────────│     │
│    │  { session_id: "abc123",    │                        │     │
│    │    choices: [...] }         │                        │     │
│    │◀─────────────────────────────│                        │     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Request Examples

### 1. Start New Conversation

```json
POST /v1/chat/completions
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "What is the capital of France?" }
  ]
}
```

**Response:**
```json
{
  "id": "chatcmpl-1234567890-abc123",
  "object": "chat.completion",
  "model": "claude-code-cli",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "The capital of France is Paris."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 25,
    "completion_tokens": 10,
    "total_tokens": 35
  },
  "session_id": "01abc123-def4-5678-90ab-cdef12345678"
}
```

### 2. Continue Conversation

```json
POST /v1/chat/completions
{
  "session_id": "01abc123-def4-5678-90ab-cdef12345678",
  "messages": [
    { "role": "user", "content": "What is its population?" }
  ]
}
```

**Response:**
```json
{
  "id": "chatcmpl-1234567891-xyz789",
  "object": "chat.completion",
  "model": "claude-code-cli",
  "choices": [{
    "index": 0,
    "message": {
      "role": "assistant",
      "content": "Paris has a population of about 2.1 million in the city proper, and over 12 million in the metropolitan area."
    },
    "finish_reason": "stop"
  }],
  "usage": {
    "prompt_tokens": 8,
    "completion_tokens": 25,
    "total_tokens": 33
  },
  "session_id": "01abc123-def4-5678-90ab-cdef12345678"
}
```

Note: Claude understood "its" refers to Paris without us resending the previous messages.

### 3. Alternative: Session ID in Header

```
POST /v1/chat/completions
X-Session-Id: 01abc123-def4-5678-90ab-cdef12345678
Content-Type: application/json

{
  "messages": [
    { "role": "user", "content": "What about London?" }
  ]
}
```

## Client Implementation Pattern

### JavaScript/TypeScript

```javascript
class ConversationClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
  }

  async chat(message) {
    const body = {
      messages: [{ role: 'user', content: message }]
    };

    // Include session_id for continuation
    if (this.sessionId) {
      body.session_id = this.sessionId;
    }

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    // Store session_id for next request
    if (data.session_id) {
      this.sessionId = data.session_id;
    }

    return data.choices[0].message.content;
  }

  // Start fresh conversation
  reset() {
    this.sessionId = null;
  }
}

// Usage
const client = new ConversationClient('http://localhost:3456');
await client.chat('What is Python?');          // New session
await client.chat('How do I install it?');     // Continues context
await client.chat('Show me a hello world');    // Still knows we're talking about Python
```

### Python

```python
import requests

class ConversationClient:
    def __init__(self, base_url):
        self.base_url = base_url
        self.session_id = None

    def chat(self, message):
        body = {
            "messages": [{"role": "user", "content": message}]
        }

        if self.session_id:
            body["session_id"] = self.session_id

        response = requests.post(
            f"{self.base_url}/v1/chat/completions",
            json=body
        )
        data = response.json()

        if "session_id" in data:
            self.session_id = data["session_id"]

        return data["choices"][0]["message"]["content"]

    def reset(self):
        self.session_id = None
```

### cURL Example

```bash
# First request - start conversation
RESPONSE=$(curl -s -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Remember the number 42"}]}')

# Extract session_id
SESSION_ID=$(echo $RESPONSE | jq -r '.session_id')

# Continue conversation
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{\"session_id\":\"$SESSION_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"What number did I ask you to remember?\"}]}"

# Claude will respond with "42" - it remembers!
```

## Session Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                     SESSION LIFECYCLE                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  1. CREATION                                                  │
│     └── First request without session_id                      │
│         └── Claude CLI creates new session                    │
│             └── Returns session_id in response                │
│                                                               │
│  2. CONTINUATION                                              │
│     └── Subsequent requests with session_id                   │
│         └── Claude CLI resumes session (--resume flag)        │
│             └── Full context preserved in Claude's memory     │
│                                                               │
│  3. EXPIRATION                                                │
│     └── Sessions persist in Claude's local storage            │
│         └── Location: ~/.claude/ (or CLAUDE_CONFIG_DIR)       │
│             └── No explicit TTL - managed by Claude CLI       │
│                                                               │
│  4. TERMINATION                                               │
│     └── Client discards session_id                            │
│         └── Next request creates new session                  │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

## Context Handling

### New Session (no session_id)

1. Server reads `CONTEXT.md` from working directory
2. Server lists directory contents
3. Context injected into system prompt
4. Full message history sent to Claude
5. Claude creates new session

### Resumed Session (with session_id)

1. **No CONTEXT.md reading** - Claude already has it
2. **No directory listing** - already in context
3. **Only latest user message sent** - Claude has history
4. Claude resumes existing session

This design minimizes redundant work and token usage.

## Token Efficiency Comparison

### OpenAI-style (stateless)

| Turn | Messages Sent | Cumulative Tokens |
|------|---------------|-------------------|
| 1 | "What is Python?" | 10 |
| 2 | "What is Python?" + response + "How to install?" | 50 |
| 3 | All above + "Hello world example" | 150 |
| 4 | All above + "Explain decorators" | 300 |

Total tokens processed: 510

### anthropic-headless-api (stateful)

| Turn | Messages Sent | Tokens This Request |
|------|---------------|---------------------|
| 1 | "What is Python?" | 10 |
| 2 | "How to install?" | 5 |
| 3 | "Hello world example" | 6 |
| 4 | "Explain decorators" | 4 |

Total tokens processed: 25

**Savings: 95% fewer input tokens** for multi-turn conversations.

## Error Handling

### Invalid Session ID

If session_id doesn't exist or expired:

```json
{
  "error": {
    "message": "Claude CLI execution failed",
    "type": "server_error",
    "code": "claude_cli_error",
    "details": {
      "sessionId": "invalid-session-id"
    }
  }
}
```

**Recovery:** Start new conversation without session_id.

### Best Practice

```javascript
async function chatWithRetry(client, message) {
  try {
    return await client.chat(message);
  } catch (error) {
    if (error.code === 'claude_cli_error') {
      // Session likely expired - start fresh
      client.reset();
      return await client.chat(message);
    }
    throw error;
  }
}
```

## Streaming Responses

Session ID is included in the **final chunk** of streaming responses:

```
data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{"content":" world"},"finish_reason":null}]}

data: {"id":"chatcmpl-123","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}],"session_id":"abc123"}

data: [DONE]
```

Client must parse the final chunk to extract session_id for continuation.
