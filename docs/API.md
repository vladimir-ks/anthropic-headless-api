---
metadata:
  modules: [anthropic-headless-api]
  tldr: "OpenAI-compatible API reference documentation"
  dependencies: []
  code_refs: [src/routes/]
---

# API Reference

## Base URL

```
http://localhost:3456
```

## Authentication

All endpoints (except health checks) require authentication via Bearer token:

```
Authorization: Bearer <api_key>
```

---

## Endpoints

### Chat Completions

#### POST /v1/chat/completions

Create a chat completion.

**Request:**

```json
{
  "model": "claude-code-cli",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful assistant."
    },
    {
      "role": "user",
      "content": "Hello!"
    }
  ],
  "stream": false,
  "max_tokens": 4096,
  "temperature": 0.7,
  "working_directory": "/path/to/context",
  "context_files": ["notes.md", "history.txt"]
}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `model` | string | No | Model identifier (ignored, uses Claude CLI) |
| `messages` | array | Yes | Array of message objects |
| `stream` | boolean | No | Enable streaming response |
| `max_tokens` | integer | No | Maximum tokens to generate |
| `temperature` | number | No | Sampling temperature (0-2) |
| `working_directory` | string | No | Directory for CONTEXT.md |
| `context_files` | array | No | Additional files to include |

**Message Object:**

| Name | Type | Description |
|------|------|-------------|
| `role` | string | `system`, `user`, or `assistant` |
| `content` | string or array | Message content |

**Multi-modal Content:**

```json
{
  "role": "user",
  "content": [
    {"type": "text", "text": "What's in this image?"},
    {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
  ]
}
```

**Response:**

```json
{
  "id": "chatcmpl-abc123",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "claude-code-cli",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! How can I help you today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 50,
    "completion_tokens": 10,
    "total_tokens": 60
  }
}
```

**Streaming Response:**

When `stream: true`, returns Server-Sent Events:

```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"Hello"}}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{"content":"!"}}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","choices":[{"delta":{},"finish_reason":"stop"}]}

data: [DONE]
```

**Headers:**

| Header | Description |
|--------|-------------|
| `X-Session-Id` | Session ID for conversation continuity |
| `X-Account-Id` | Preferred account for routing |
| `X-Request-Id` | Request ID for tracing |

---

### Batch Processing

#### POST /v1/chat/completions/batch

Submit a batch of requests for async processing.

**Request:**

```json
{
  "requests": [
    {
      "custom_id": "req-001",
      "messages": [{"role": "user", "content": "Question 1"}]
    },
    {
      "custom_id": "req-002",
      "messages": [{"role": "user", "content": "Question 2"}]
    }
  ],
  "priority": "normal",
  "schedule": "immediate",
  "webhook_url": "https://example.com/webhook"
}
```

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `requests` | array | Yes | Array of batch requests |
| `priority` | string | No | `low`, `normal`, `high` |
| `schedule` | string | No | `immediate`, `end_of_window`, `off_peak` |
| `webhook_url` | string | No | URL for completion notification |

**Response:**

```json
{
  "batch_id": "batch-xyz789",
  "status": "queued",
  "total_requests": 2,
  "completed_requests": 0,
  "failed_requests": 0,
  "created_at": "2025-01-16T12:00:00Z",
  "estimated_completion": "2025-01-16T13:00:00Z"
}
```

#### GET /v1/chat/completions/batch/:id

Get batch job status.

**Response:**

```json
{
  "batch_id": "batch-xyz789",
  "status": "completed",
  "total_requests": 2,
  "completed_requests": 2,
  "failed_requests": 0,
  "results": [
    {
      "custom_id": "req-001",
      "status": "success",
      "response": {
        "id": "chatcmpl-...",
        "choices": [...]
      }
    },
    {
      "custom_id": "req-002",
      "status": "success",
      "response": {...}
    }
  ],
  "created_at": "2025-01-16T12:00:00Z",
  "completed_at": "2025-01-16T12:30:00Z"
}
```

#### DELETE /v1/chat/completions/batch/:id

Cancel a batch job.

**Response:**

```json
{
  "batch_id": "batch-xyz789",
  "status": "cancelled",
  "cancelled_at": "2025-01-16T12:15:00Z"
}
```

---

### Files

#### POST /v1/files

Upload a file for use in messages.

**Request:**

```
Content-Type: multipart/form-data

file: <binary>
purpose: context
```

**Response:**

```json
{
  "id": "file-abc123",
  "object": "file",
  "bytes": 12345,
  "created_at": 1234567890,
  "filename": "document.pdf",
  "purpose": "context"
}
```

#### GET /v1/files/:id

Get file information.

#### DELETE /v1/files/:id

Delete a file.

---

### Models

#### GET /v1/models

List available models.

**Response:**

```json
{
  "object": "list",
  "data": [
    {
      "id": "claude-code-cli",
      "object": "model",
      "created": 1234567890,
      "owned_by": "anthropic"
    }
  ]
}
```

---

### Admin

#### GET /admin/accounts

List all configured accounts and their status.

**Response:**

```json
{
  "accounts": [
    {
      "id": "account-1",
      "name": "Primary Max",
      "plan": "max",
      "enabled": true,
      "health": "healthy",
      "quota": {
        "used_tokens": 500000,
        "limit_tokens": 5000000,
        "used_percent": 10,
        "reset_at": "2025-01-17T00:00:00Z"
      },
      "stats": {
        "requests_today": 150,
        "avg_latency_ms": 2500,
        "error_rate": 0.01
      }
    }
  ]
}
```

#### GET /admin/accounts/:id/usage

Get detailed usage for an account.

**Query Parameters:**

| Name | Type | Description |
|------|------|-------------|
| `window` | string | `1h`, `24h`, `7d`, `30d` |
| `group_by` | string | `hour`, `day`, `model` |

**Response:**

```json
{
  "account_id": "account-1",
  "window": "24h",
  "summary": {
    "total_requests": 150,
    "total_input_tokens": 250000,
    "total_output_tokens": 50000,
    "total_cost_usd": 15.50,
    "avg_latency_ms": 2500
  },
  "by_hour": [
    {
      "hour": "2025-01-16T10:00:00Z",
      "requests": 25,
      "tokens": 50000,
      "cost_usd": 2.50
    }
  ]
}
```

#### POST /admin/accounts/:id/enable

Enable an account.

#### POST /admin/accounts/:id/disable

Disable an account.

#### GET /admin/sessions

List active sessions.

**Response:**

```json
{
  "sessions": [
    {
      "id": "session-abc",
      "account_id": "account-1",
      "created_at": "2025-01-16T10:00:00Z",
      "last_used_at": "2025-01-16T12:00:00Z",
      "message_count": 15,
      "total_tokens": 25000
    }
  ]
}
```

#### GET /admin/queue

Get queue status.

**Response:**

```json
{
  "queue": {
    "pending": 5,
    "processing": 2,
    "completed_today": 150,
    "failed_today": 3
  },
  "by_priority": {
    "high": 1,
    "normal": 4,
    "low": 2
  }
}
```

---

### Health

#### GET /health

Basic health check.

**Response:**

```json
{
  "status": "ok",
  "version": "0.1.0",
  "backend": "claude-code-cli"
}
```

#### GET /health/ready

Readiness check (returns 503 if not ready).

**Response:**

```json
{
  "ready": true,
  "checks": {
    "claude_cli": true,
    "database": true,
    "accounts": {
      "account-1": true,
      "account-2": true
    }
  }
}
```

#### GET /health/live

Liveness check.

**Response:**

```json
{
  "alive": true,
  "uptime_seconds": 3600
}
```

#### GET /metrics

Prometheus metrics endpoint.

**Response:**

```
# HELP http_requests_total Total HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="POST",path="/v1/chat/completions",status="200"} 150

# HELP claude_tokens_total Total tokens used
# TYPE claude_tokens_total counter
claude_tokens_total{account_id="account-1",type="input"} 500000
claude_tokens_total{account_id="account-1",type="output"} 100000
```

---

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "message": "Human-readable error message",
    "type": "error_type",
    "code": "error_code",
    "param": "field_name",
    "details": {}
  }
}
```

**Error Types:**

| Type | HTTP Status | Description |
|------|-------------|-------------|
| `invalid_request_error` | 400 | Malformed request |
| `authentication_error` | 401 | Invalid API key |
| `rate_limit_error` | 429 | Too many requests |
| `server_error` | 500+ | Internal error |

**Error Codes:**

| Code | Description |
|------|-------------|
| `invalid_messages` | Messages array invalid |
| `auth_failed` | Authentication failed |
| `rate_limited` | Rate limit exceeded |
| `quota_exceeded` | Account quota exceeded |
| `claude_cli_error` | Claude CLI execution failed |
| `claude_cli_timeout` | Claude CLI timed out |
| `account_unavailable` | No accounts available |
| `internal_error` | Unexpected server error |

---

## Rate Limits

Default rate limits per API key:

| Plan | Requests/min | Concurrent |
|------|--------------|------------|
| Free | 10 | 1 |
| Basic | 60 | 5 |
| Pro | 300 | 20 |

Headers included in response:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 55
X-RateLimit-Reset: 1234567890
```

---

## Webhooks

Batch job webhooks send POST requests:

```json
{
  "event": "batch.completed",
  "batch_id": "batch-xyz789",
  "status": "completed",
  "total_requests": 10,
  "completed_requests": 10,
  "failed_requests": 0,
  "timestamp": "2025-01-16T12:00:00Z"
}
```

**Events:**
- `batch.started` - Batch processing started
- `batch.completed` - Batch finished (success or partial)
- `batch.failed` - Batch failed completely
