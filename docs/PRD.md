---
metadata:
  modules: [anthropic-headless-api]
  tldr: "Product Requirements Document for production-grade Claude Code CLI API wrapper"
  dependencies: []
  code_refs: [src/]
---

# anthropic-headless-api - Product Requirements Document

## Executive Summary

Build a production-grade, OpenAI-compatible API server that wraps Claude Code CLI, enabling:
- Multi-account routing with session affinity
- Quota tracking and optimization
- Batch/async processing
- Full observability (Sentry, Langfuse)
- Multi-modal support (images, files)

## 1. Problem Statement

### Current Limitations
1. Claude Code CLI is single-user, single-session
2. No programmatic quota tracking
3. No integration with observability tools
4. Can't route requests across multiple accounts
5. No async/batch processing for rate limit optimization

### Goal
Create an unblockable API layer that:
- Uses Claude Code CLI (`-p` mode) as backend
- Exposes OpenAI-compatible endpoints
- Manages multiple Claude accounts
- Optimizes quota usage across accounts
- Provides full observability

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENTS                                         │
│   OpenCode │ LiteLLM │ Custom Apps │ Batch Jobs │ Async Workers             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          API GATEWAY LAYER                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Auth/API Key │  │ Rate Limiter │  │ Request      │  │ Langfuse     │    │
│  │ Validation   │  │              │  │ Validation   │  │ Tracing      │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ROUTING LAYER                                       │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ Account Router   │  │ Session Affinity │  │ Load Balancer    │          │
│  │ (quota-aware)    │  │ Manager          │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          PROCESSING LAYER                                    │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐          │
│  │ Sync Handler     │  │ Async Queue      │  │ Batch Processor  │          │
│  │                  │  │ (Redis/SQLite)   │  │                  │          │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘          │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          EXECUTION LAYER                                     │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                    Claude CLI Executor Pool                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │  │
│  │  │ Account 1   │  │ Account 2   │  │ Account 3   │  │ Account N   │ │  │
│  │  │ ~/.claude-  │  │ ~/.claude-  │  │ ~/.claude-  │  │ ~/.claude-  │ │  │
│  │  │ inst-a1/    │  │ inst-a2/    │  │ inst-a3/    │  │ inst-aN/    │ │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          OBSERVABILITY LAYER                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ Sentry       │  │ Langfuse     │  │ Prometheus   │  │ Health       │    │
│  │ (errors)     │  │ (traces)     │  │ (metrics)    │  │ Checks       │    │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 3. Functional Requirements

### 3.1 Core API (OpenAI-compatible)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/chat/completions` | POST | Chat completions (sync/stream) |
| `/v1/chat/completions/batch` | POST | Submit batch job |
| `/v1/chat/completions/batch/{id}` | GET | Get batch status |
| `/v1/models` | GET | List available models |
| `/v1/files` | POST | Upload files (images, docs) |
| `/v1/files/{id}` | GET | Get file info |
| `/health` | GET | Health check |
| `/metrics` | GET | Prometheus metrics |
| `/admin/accounts` | GET | List accounts & quotas |
| `/admin/accounts/{id}/usage` | GET | Account usage details |

### 3.2 Multi-Account Management

**Account Registration:**
```yaml
accounts:
  - id: "account-1"
    name: "Primary Max"
    config_dir: "~/.claude-inst-a1"
    plan: "max"            # pro, max, team, enterprise
    priority: 1            # Lower = higher priority
    enabled: true

  - id: "account-2"
    name: "Secondary Pro"
    config_dir: "~/.claude-inst-a2"
    plan: "pro"
    priority: 2
    enabled: true
```

**Session Affinity:**
- Same `session_id` → same account (for conversation history)
- New sessions → route to account with most available quota
- Sticky sessions via header: `X-Account-Id: account-1`

### 3.3 Quota Tracking

**Data captured per request (from Claude CLI JSON output):**
```typescript
interface RequestUsage {
  session_id: string;
  account_id: string;
  timestamp: Date;
  duration_ms: number;
  duration_api_ms: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  model_usage: Record<string, ModelUsage>;
}
```

**Quota Windows:**
- Daily reset tracking
- Rolling window tracking (last 5 min, 1 hour)
- Predict quota exhaustion time

### 3.4 Async/Batch Processing

**Batch Job Submission:**
```json
POST /v1/chat/completions/batch
{
  "requests": [
    {"custom_id": "req-1", "messages": [...]},
    {"custom_id": "req-2", "messages": [...]}
  ],
  "priority": "low",           // low, normal, high
  "schedule": "end_of_window", // immediate, end_of_window, off_peak
  "webhook_url": "https://..."
}
```

**Response:**
```json
{
  "batch_id": "batch-xxx",
  "status": "queued",
  "total_requests": 2,
  "estimated_completion": "2025-01-16T20:00:00Z"
}
```

**Scheduling Strategies:**
- `immediate`: Process now
- `end_of_window`: Process in last hour before quota reset
- `off_peak`: Process when quota usage is below threshold

### 3.5 Multi-modal Support

**Image Input:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "What's in this image?"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,..."}}
      ]
    }
  ]
}
```

**File Upload:**
```json
POST /v1/files
Content-Type: multipart/form-data
file: <binary>
purpose: "context"
```

### 3.6 Context Management

**CONTEXT.md Support:**
- Auto-read from `working_directory`
- Inject into system prompt
- Support for includes: `@file.md`

**Context Files:**
```json
{
  "working_directory": "/path/to/project",
  "context_files": ["patient-history.md", "lab-results.txt"],
  "context_depth": 2  // Directory listing depth
}
```

## 4. Non-Functional Requirements

### 4.1 Reliability

| Requirement | Target |
|-------------|--------|
| Uptime | 99.9% |
| Request timeout | 120s (configurable) |
| Retry on transient failure | 3 attempts |
| Graceful shutdown | 30s drain |

### 4.2 Error Handling

**Error Categories:**
```typescript
enum ErrorCode {
  // Client errors (4xx)
  INVALID_REQUEST = 'invalid_request',
  AUTHENTICATION_FAILED = 'auth_failed',
  RATE_LIMITED = 'rate_limited',
  QUOTA_EXCEEDED = 'quota_exceeded',

  // Server errors (5xx)
  CLAUDE_CLI_ERROR = 'claude_cli_error',
  CLAUDE_CLI_TIMEOUT = 'claude_cli_timeout',
  ACCOUNT_UNAVAILABLE = 'account_unavailable',
  INTERNAL_ERROR = 'internal_error',
}
```

**Error Response:**
```json
{
  "error": {
    "message": "Human-readable description",
    "type": "invalid_request_error",
    "code": "invalid_messages",
    "param": "messages",
    "details": {
      "account_id": "account-1",
      "retry_after": 60
    }
  }
}
```

### 4.3 Observability

**Sentry Integration:**
- Capture all errors with context
- Performance monitoring
- Release tracking

**Langfuse Integration:**
- Trace every request
- Capture prompts and responses
- Token usage tracking
- Cost attribution

**Prometheus Metrics:**
```
# Request metrics
http_requests_total{method, path, status}
http_request_duration_seconds{method, path}

# Claude CLI metrics
claude_requests_total{account_id, model, status}
claude_request_duration_seconds{account_id, model}
claude_tokens_total{account_id, model, type}
claude_cost_usd_total{account_id, model}

# Quota metrics
claude_quota_used_tokens{account_id, window}
claude_quota_remaining_tokens{account_id, window}
claude_quota_reset_seconds{account_id}

# Queue metrics
batch_queue_size{priority}
batch_processing_time_seconds
```

### 4.4 Security

| Aspect | Implementation |
|--------|----------------|
| API Authentication | Bearer token / API key |
| Transport | HTTPS (TLS 1.3) |
| Secrets | Environment variables / Keychain |
| Input validation | Zod schemas |
| Rate limiting | Per-client, per-account |

## 5. Technical Specifications

### 5.1 Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun |
| HTTP Server | Bun.serve |
| Validation | Zod |
| Queue | BullMQ (Redis) or SQLite |
| Metrics | prom-client |
| Tracing | Langfuse SDK |
| Errors | Sentry SDK |
| Config | YAML + env vars |

### 5.2 Project Structure

```
anthropic-headless-api/
├── src/
│   ├── index.ts                 # Entry point
│   ├── config/
│   │   ├── index.ts             # Config loader
│   │   ├── schema.ts            # Config validation
│   │   └── accounts.ts          # Account config
│   ├── types/
│   │   ├── api.ts               # OpenAI-compatible types
│   │   ├── internal.ts          # Internal types
│   │   └── errors.ts            # Error types
│   ├── lib/
│   │   ├── claude-cli.ts        # CLI executor
│   │   ├── context-reader.ts    # CONTEXT.md reader
│   │   ├── multimodal.ts        # Image/file handling
│   │   └── session-store.ts     # Session tracking
│   ├── services/
│   │   ├── account-router.ts    # Multi-account routing
│   │   ├── quota-tracker.ts     # Quota management
│   │   ├── batch-processor.ts   # Async/batch jobs
│   │   └── scheduler.ts         # Job scheduling
│   ├── routes/
│   │   ├── chat.ts              # Chat completions
│   │   ├── batch.ts             # Batch endpoints
│   │   ├── files.ts             # File upload
│   │   ├── admin.ts             # Admin endpoints
│   │   └── health.ts            # Health/metrics
│   ├── middleware/
│   │   ├── auth.ts              # Authentication
│   │   ├── rate-limit.ts        # Rate limiting
│   │   ├── validation.ts        # Request validation
│   │   └── tracing.ts           # Langfuse middleware
│   └── observability/
│       ├── sentry.ts            # Sentry setup
│       ├── langfuse.ts          # Langfuse setup
│       └── metrics.ts           # Prometheus metrics
├── config/
│   ├── default.yaml             # Default config
│   └── accounts.yaml            # Account definitions
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── docs/
│   ├── PRD.md                   # This document
│   ├── API.md                   # API documentation
│   └── DEPLOYMENT.md            # Deployment guide
└── scripts/
    ├── setup-account.sh         # Account setup helper
    └── health-check.sh          # Health check script
```

### 5.3 Configuration Schema

```yaml
# config/default.yaml
server:
  port: 3456
  host: "127.0.0.1"
  cors: true
  request_timeout_ms: 120000
  graceful_shutdown_ms: 30000

auth:
  enabled: true
  api_keys:
    - key: "${API_KEY_1}"
      name: "primary"
      rate_limit: 100  # requests per minute

context:
  filename: "CONTEXT.md"
  max_depth: 2
  max_file_size_kb: 100

observability:
  sentry:
    enabled: true
    dsn: "${SENTRY_DSN}"
    environment: "production"
  langfuse:
    enabled: true
    public_key: "${LANGFUSE_PUBLIC_KEY}"
    secret_key: "${LANGFUSE_SECRET_KEY}"
    host: "https://cloud.langfuse.com"
  prometheus:
    enabled: true
    path: "/metrics"

queue:
  type: "sqlite"  # or "redis"
  sqlite_path: "./data/queue.db"
  # redis_url: "redis://localhost:6379"

scheduling:
  default_priority: "normal"
  off_peak_hours: [0, 1, 2, 3, 4, 5]  # UTC
  quota_threshold_percent: 80  # Trigger off-peak when above
```

## 6. Implementation Phases

### Phase 1: Foundation (Current)
- [x] Basic OpenAI-compatible API
- [x] CONTEXT.md reading
- [x] Claude CLI wrapper
- [ ] Comprehensive error handling
- [ ] Request validation (Zod)
- [ ] Configuration management

### Phase 2: Observability
- [ ] Sentry integration
- [ ] Langfuse integration
- [ ] Prometheus metrics
- [ ] Health check improvements

### Phase 3: Multi-Account
- [ ] Account configuration
- [ ] Session affinity
- [ ] Quota tracking
- [ ] Account routing

### Phase 4: Async/Batch
- [ ] Queue infrastructure
- [ ] Batch job API
- [ ] Scheduler
- [ ] Webhook notifications

### Phase 5: Advanced Features
- [ ] Multi-modal support
- [ ] File upload
- [ ] Context file includes
- [ ] Admin dashboard

## 7. Testing Strategy

### Unit Tests
- Config validation
- Request/response parsing
- Quota calculations
- Error handling

### Integration Tests
- Claude CLI execution
- Account routing
- Queue processing

### E2E Tests
- Full request flow
- Batch processing
- Multi-account scenarios

## 8. Deployment

### Local Development
```bash
bun install
cp config/default.yaml config/local.yaml
# Edit local.yaml
bun run dev
```

### Production (Docker)
```dockerfile
FROM oven/bun:1
WORKDIR /app
COPY . .
RUN bun install --production
CMD ["bun", "run", "start"]
```

### Environment Variables
```bash
# Required
PORT=3456
API_KEY_1=sk-xxx

# Observability
SENTRY_DSN=https://xxx@sentry.io/xxx
LANGFUSE_PUBLIC_KEY=pk-xxx
LANGFUSE_SECRET_KEY=sk-xxx

# Accounts (alternative to yaml)
CLAUDE_ACCOUNTS='[{"id":"a1","config_dir":"~/.claude-inst-a1"}]'
```

## 9. Open Questions

1. **Persistence**: SQLite vs Redis for queue/state?
2. **Scaling**: Single instance vs multi-instance coordination?
3. **Account auth**: Manual setup or automate OAuth flow?
4. **Caching**: Cache responses for identical prompts?
5. **Billing**: Track costs per API key/client?

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| API latency (p50) | < 100ms overhead |
| API latency (p99) | < 500ms overhead |
| Error rate | < 0.1% |
| Quota utilization | > 90% |
| Batch completion | > 99% |

---

## Appendix A: Claude CLI JSON Output Schema

```typescript
interface ClaudeCliOutput {
  type: "result";
  subtype: "success" | "error";
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    server_tool_use: {
      web_search_requests: number;
      web_fetch_requests: number;
    };
    service_tier: string;
  };
  modelUsage: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
    webSearchRequests: number;
    costUSD: number;
    contextWindow: number;
    maxOutputTokens: number;
  }>;
  permission_denials: string[];
  uuid: string;
}
```

## Appendix B: Additional Considerations

### Things You Might Have Forgotten

1. **Request Deduplication**: Prevent duplicate requests within short window
2. **Conversation Caching**: Cache Claude's prompt caching state per session
3. **Warm-up**: Pre-warm accounts to reduce cold start latency
4. **Fallback Chain**: If account 1 fails, try account 2
5. **Cost Alerts**: Notify when approaching budget limits
6. **Audit Log**: Record all requests for compliance
7. **Client SDKs**: TypeScript/Python clients for easier integration
8. **OpenAPI Spec**: Generate from types for documentation
9. **Retry Budgets**: Limit total retry attempts across accounts
10. **Circuit Breaker**: Disable account if error rate too high
11. **Request Priority**: VIP clients get priority routing
12. **Response Caching**: Cache identical prompt responses
13. **Streaming Backpressure**: Handle slow clients properly
14. **Concurrent Request Limits**: Per account, per client
15. **Session Garbage Collection**: Clean up old sessions
16. **Timezone Handling**: Quota windows in user's timezone?
17. **Multi-region**: Deploy close to users?
18. **Backup/Restore**: State persistence and recovery
