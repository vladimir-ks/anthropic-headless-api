---
metadata:
  modules: [anthropic-headless-api]
  tldr: "Technical architecture and module specifications"
  dependencies: [PRD.md]
  code_refs: [src/]
---

# Architecture Document

## 1. System Overview

### Design Principles

1. **Modularity**: Each concern in its own module
2. **Testability**: Dependency injection, pure functions
3. **Observability**: Trace everything, measure everything
4. **Resilience**: Graceful degradation, circuit breakers
5. **Extensibility**: Plugin architecture for new features

### Request Flow

```
Client Request
     │
     ▼
┌─────────────────┐
│  HTTP Handler   │ ← Bun.serve
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Middleware     │ ← Auth, Validation, Rate Limit, Tracing
│  Pipeline       │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Route Handler  │ ← Business logic
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Account Router │ ← Select best account
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CLI Executor   │ ← Execute claude -p
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Response       │ ← Transform, trace, return
│  Handler        │
└─────────────────┘
```

## 2. Module Specifications

### 2.1 Config Module (`src/config/`)

**Purpose**: Centralized configuration management

**Files:**
- `index.ts` - Config loader and validator
- `schema.ts` - Zod schemas for validation
- `accounts.ts` - Account-specific config

**Interface:**
```typescript
interface Config {
  server: ServerConfig;
  auth: AuthConfig;
  context: ContextConfig;
  observability: ObservabilityConfig;
  queue: QueueConfig;
  scheduling: SchedulingConfig;
  accounts: AccountConfig[];
}

// Load config from multiple sources
function loadConfig(): Config {
  // 1. Load default.yaml
  // 2. Merge environment-specific yaml
  // 3. Override with env vars
  // 4. Validate with Zod
}
```

**Responsibilities:**
- Load YAML config files
- Merge environment overrides
- Validate all config
- Provide typed config access

---

### 2.2 Types Module (`src/types/`)

**Purpose**: Type definitions and validation schemas

**Files:**
- `api.ts` - OpenAI-compatible request/response types
- `internal.ts` - Internal domain types
- `errors.ts` - Error types and codes
- `schemas.ts` - Zod validation schemas

**Key Types:**
```typescript
// Request validation
const ChatCompletionRequestSchema = z.object({
  model: z.string().optional(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
  max_tokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  working_directory: z.string().optional(),
  context_files: z.array(z.string()).optional(),
});

// Error handling
class APIError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public statusCode: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}
```

---

### 2.3 Lib Module (`src/lib/`)

**Purpose**: Core utilities and infrastructure

#### 2.3.1 Claude CLI Executor (`claude-cli.ts`)

**Responsibilities:**
- Execute `claude -p` with proper arguments
- Parse JSON output
- Handle timeouts and errors
- Manage process lifecycle

**Interface:**
```typescript
interface ClaudeExecutor {
  execute(options: ExecuteOptions): Promise<ExecuteResult>;
  isAvailable(configDir: string): Promise<boolean>;
}

interface ExecuteOptions {
  query: string;
  systemPrompt?: string;
  configDir: string;
  timeout?: number;
  outputFormat: 'text' | 'json' | 'stream-json';
  sessionId?: string;
  model?: string;
}

interface ExecuteResult {
  success: boolean;
  output: string;
  metadata?: ClaudeMetadata;  // From JSON output
  error?: string;
}
```

#### 2.3.2 Context Reader (`context-reader.ts`)

**Responsibilities:**
- Read CONTEXT.md from directory
- List directory contents
- Process file includes (`@file.md`)
- Size and depth limits

**Interface:**
```typescript
interface ContextReader {
  read(directory: string, options: ContextOptions): Promise<ContextInfo>;
  readFiles(directory: string, files: string[]): Promise<Map<string, string>>;
}

interface ContextOptions {
  filename: string;       // Default: CONTEXT.md
  maxDepth: number;       // Directory listing depth
  maxFileSize: number;    // KB
  processIncludes: boolean;
}
```

#### 2.3.3 Multimodal Handler (`multimodal.ts`)

**Responsibilities:**
- Parse image URLs (data: and http:)
- Convert images to base64
- Validate file types
- Size limits

**Interface:**
```typescript
interface MultimodalHandler {
  processMessages(messages: Message[]): Promise<ProcessedMessages>;
  uploadFile(file: File, purpose: string): Promise<FileInfo>;
  getFile(fileId: string): Promise<FileInfo | null>;
}
```

#### 2.3.4 Session Store (`session-store.ts`)

**Responsibilities:**
- Track session → account mapping
- Store conversation metadata
- Garbage collection of old sessions

**Interface:**
```typescript
interface SessionStore {
  get(sessionId: string): Promise<SessionInfo | null>;
  set(sessionId: string, info: SessionInfo): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(maxAge: number): Promise<number>;  // Returns deleted count
}

interface SessionInfo {
  sessionId: string;
  accountId: string;
  createdAt: Date;
  lastUsedAt: Date;
  messageCount: number;
  totalTokens: number;
  totalCost: number;
}
```

---

### 2.4 Services Module (`src/services/`)

**Purpose**: Business logic and coordination

#### 2.4.1 Account Router (`account-router.ts`)

**Responsibilities:**
- Select best account for request
- Maintain session affinity
- Track quota per account
- Implement fallback chain

**Interface:**
```typescript
interface AccountRouter {
  route(request: RouteRequest): Promise<RouteResult>;
  getAccountStatus(accountId: string): Promise<AccountStatus>;
  getAllAccounts(): Promise<AccountStatus[]>;
}

interface RouteRequest {
  sessionId?: string;
  preferredAccountId?: string;
  estimatedTokens?: number;
  priority: Priority;
}

interface RouteResult {
  accountId: string;
  configDir: string;
  reason: RouteReason;  // 'session_affinity' | 'quota_available' | 'fallback'
}

interface AccountStatus {
  id: string;
  name: string;
  enabled: boolean;
  plan: Plan;
  quota: {
    used: number;
    limit: number;
    resetAt: Date;
  };
  health: 'healthy' | 'degraded' | 'unavailable';
  lastError?: string;
}
```

**Routing Algorithm:**
```
1. If sessionId provided and session exists → return session's account
2. If preferredAccountId provided and available → use it
3. Sort accounts by: enabled → health → quota_remaining → priority
4. Select first account with sufficient quota
5. If none available, return error or queue for later
```

#### 2.4.2 Quota Tracker (`quota-tracker.ts`)

**Responsibilities:**
- Track usage per account
- Predict quota exhaustion
- Alert on threshold
- Persist to storage

**Interface:**
```typescript
interface QuotaTracker {
  record(accountId: string, usage: UsageRecord): Promise<void>;
  getUsage(accountId: string, window: TimeWindow): Promise<UsageSummary>;
  predictExhaustion(accountId: string): Promise<Date | null>;
  setAlert(accountId: string, threshold: number): Promise<void>;
}

interface UsageRecord {
  timestamp: Date;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  costUsd: number;
  model: string;
}

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  requestCount: number;
  avgLatency: number;
  windowStart: Date;
  windowEnd: Date;
}
```

#### 2.4.3 Batch Processor (`batch-processor.ts`)

**Responsibilities:**
- Accept batch job submissions
- Queue jobs with priority
- Process asynchronously
- Track job status
- Send webhook notifications

**Interface:**
```typescript
interface BatchProcessor {
  submit(job: BatchJob): Promise<BatchStatus>;
  getStatus(batchId: string): Promise<BatchStatus | null>;
  cancel(batchId: string): Promise<boolean>;
  list(filters: BatchFilters): Promise<BatchStatus[]>;
}

interface BatchJob {
  requests: BatchRequest[];
  priority: Priority;
  schedule: Schedule;
  webhookUrl?: string;
  metadata?: Record<string, unknown>;
}

interface BatchStatus {
  batchId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
  totalRequests: number;
  completedRequests: number;
  failedRequests: number;
  results?: BatchResult[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  estimatedCompletion?: Date;
}
```

#### 2.4.4 Scheduler (`scheduler.ts`)

**Responsibilities:**
- Determine optimal processing time
- Monitor quota windows
- Trigger batch processing
- Handle cron-like schedules

**Interface:**
```typescript
interface Scheduler {
  schedule(job: ScheduledJob): Promise<string>;
  cancel(jobId: string): Promise<boolean>;
  getNextRun(jobId: string): Promise<Date | null>;
  start(): void;
  stop(): void;
}

interface ScheduledJob {
  id: string;
  type: 'batch' | 'cleanup' | 'healthcheck';
  schedule: CronExpression | Date | 'end_of_window';
  handler: () => Promise<void>;
}
```

---

### 2.5 Routes Module (`src/routes/`)

**Purpose**: HTTP endpoint handlers

#### 2.5.1 Chat Routes (`chat.ts`)

**Endpoints:**
- `POST /v1/chat/completions` - Sync/streaming completions

**Handler Flow:**
```
1. Validate request (Zod)
2. Extract/create session ID
3. Route to account
4. Read context if working_directory provided
5. Build system prompt with context
6. Execute Claude CLI
7. Parse response
8. Record usage
9. Trace with Langfuse
10. Return response
```

#### 2.5.2 Batch Routes (`batch.ts`)

**Endpoints:**
- `POST /v1/chat/completions/batch` - Submit batch
- `GET /v1/chat/completions/batch/:id` - Get status
- `DELETE /v1/chat/completions/batch/:id` - Cancel batch

#### 2.5.3 Files Routes (`files.ts`)

**Endpoints:**
- `POST /v1/files` - Upload file
- `GET /v1/files/:id` - Get file info
- `DELETE /v1/files/:id` - Delete file

#### 2.5.4 Admin Routes (`admin.ts`)

**Endpoints:**
- `GET /admin/accounts` - List accounts
- `GET /admin/accounts/:id/usage` - Account usage
- `POST /admin/accounts/:id/enable` - Enable account
- `POST /admin/accounts/:id/disable` - Disable account
- `GET /admin/sessions` - List active sessions
- `GET /admin/queue` - Queue status

#### 2.5.5 Health Routes (`health.ts`)

**Endpoints:**
- `GET /health` - Basic health check
- `GET /health/ready` - Readiness (all accounts available)
- `GET /health/live` - Liveness (process running)
- `GET /metrics` - Prometheus metrics

---

### 2.6 Middleware Module (`src/middleware/`)

**Purpose**: Request processing pipeline

#### 2.6.1 Auth Middleware (`auth.ts`)

**Responsibilities:**
- Validate API key
- Extract client identity
- Rate limit per client

**Implementation:**
```typescript
function authMiddleware(config: AuthConfig) {
  return async (req: Request, next: NextFn) => {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      throw new APIError('auth_failed', 'Missing API key', 401);
    }

    const apiKey = authHeader.slice(7);
    const client = config.apiKeys.find(k => k.key === apiKey);
    if (!client) {
      throw new APIError('auth_failed', 'Invalid API key', 401);
    }

    req.client = client;
    return next(req);
  };
}
```

#### 2.6.2 Validation Middleware (`validation.ts`)

**Responsibilities:**
- Validate request body against schema
- Sanitize inputs
- Reject malformed requests

#### 2.6.3 Rate Limit Middleware (`rate-limit.ts`)

**Responsibilities:**
- Track requests per client
- Enforce rate limits
- Return retry-after headers

#### 2.6.4 Tracing Middleware (`tracing.ts`)

**Responsibilities:**
- Create Langfuse trace
- Attach trace ID to request
- Record duration and status

---

### 2.7 Observability Module (`src/observability/`)

#### 2.7.1 Sentry Integration (`sentry.ts`)

**Setup:**
```typescript
import * as Sentry from '@sentry/bun';

export function initSentry(config: SentryConfig) {
  Sentry.init({
    dsn: config.dsn,
    environment: config.environment,
    release: process.env.VERSION,
    integrations: [
      Sentry.httpIntegration(),
    ],
    tracesSampleRate: 0.1,
  });
}

export function captureError(error: Error, context?: Record<string, unknown>) {
  Sentry.captureException(error, { extra: context });
}
```

#### 2.7.2 Langfuse Integration (`langfuse.ts`)

**Setup:**
```typescript
import { Langfuse } from 'langfuse';

export function initLangfuse(config: LangfuseConfig): Langfuse {
  return new Langfuse({
    publicKey: config.publicKey,
    secretKey: config.secretKey,
    baseUrl: config.host,
  });
}

export function traceRequest(
  langfuse: Langfuse,
  request: ChatCompletionRequest,
  response: ChatCompletionResponse,
  metadata: TraceMetadata
) {
  const trace = langfuse.trace({
    name: 'chat-completion',
    metadata: {
      accountId: metadata.accountId,
      sessionId: metadata.sessionId,
    },
  });

  trace.generation({
    name: 'claude-cli',
    model: 'claude-code-cli',
    input: request.messages,
    output: response.choices[0]?.message.content,
    usage: {
      input: response.usage.prompt_tokens,
      output: response.usage.completion_tokens,
    },
    metadata: {
      costUsd: metadata.costUsd,
      durationMs: metadata.durationMs,
    },
  });

  return trace;
}
```

#### 2.7.3 Prometheus Metrics (`metrics.ts`)

**Metrics Registry:**
```typescript
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

const registry = new Registry();

// Request metrics
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'path', 'status'],
  registers: [registry],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration',
  labelNames: ['method', 'path'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

// Claude metrics
export const claudeRequestsTotal = new Counter({
  name: 'claude_requests_total',
  help: 'Total Claude CLI requests',
  labelNames: ['account_id', 'model', 'status'],
  registers: [registry],
});

export const claudeTokensTotal = new Counter({
  name: 'claude_tokens_total',
  help: 'Total tokens used',
  labelNames: ['account_id', 'type'],  // input, output, cache
  registers: [registry],
});

// Quota metrics
export const quotaUsedGauge = new Gauge({
  name: 'claude_quota_used_percent',
  help: 'Quota usage percentage',
  labelNames: ['account_id'],
  registers: [registry],
});
```

---

## 3. Data Storage

### 3.1 SQLite Schema (Default)

```sql
-- Sessions table
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  total_cost_usd REAL DEFAULT 0
);

-- Usage records
CREATE TABLE usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  session_id TEXT,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cache_tokens INTEGER,
  cost_usd REAL,
  model TEXT,
  duration_ms INTEGER
);

-- Batch jobs
CREATE TABLE batch_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  schedule TEXT,
  webhook_url TEXT,
  total_requests INTEGER,
  completed_requests INTEGER DEFAULT 0,
  failed_requests INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME,
  completed_at DATETIME,
  metadata TEXT  -- JSON
);

-- Batch requests
CREATE TABLE batch_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  custom_id TEXT,
  status TEXT NOT NULL,
  request TEXT NOT NULL,  -- JSON
  response TEXT,          -- JSON
  error TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  completed_at DATETIME,
  FOREIGN KEY (batch_id) REFERENCES batch_jobs(id)
);

-- Indexes
CREATE INDEX idx_sessions_account ON sessions(account_id);
CREATE INDEX idx_usage_account_time ON usage_records(account_id, timestamp);
CREATE INDEX idx_batch_status ON batch_jobs(status);
CREATE INDEX idx_batch_requests_batch ON batch_requests(batch_id);
```

### 3.2 File Storage

```
data/
├── queue.db           # SQLite database
├── files/             # Uploaded files
│   └── {file_id}/
│       ├── metadata.json
│       └── content
└── logs/              # Debug logs (optional)
```

---

## 4. Error Handling Strategy

### 4.1 Error Categories

```typescript
enum ErrorCategory {
  CLIENT = 'client',      // 4xx - client's fault
  SERVER = 'server',      // 5xx - our fault
  UPSTREAM = 'upstream',  // Claude CLI issues
  TRANSIENT = 'transient' // Retry-able
}

const ERROR_MAP: Record<ErrorCode, ErrorInfo> = {
  // Client errors
  'invalid_request': { status: 400, category: 'client', retryable: false },
  'auth_failed': { status: 401, category: 'client', retryable: false },
  'rate_limited': { status: 429, category: 'client', retryable: true },
  'quota_exceeded': { status: 429, category: 'client', retryable: true },

  // Server errors
  'internal_error': { status: 500, category: 'server', retryable: false },
  'claude_cli_error': { status: 502, category: 'upstream', retryable: true },
  'claude_cli_timeout': { status: 504, category: 'upstream', retryable: true },
  'account_unavailable': { status: 503, category: 'transient', retryable: true },
};
```

### 4.2 Retry Strategy

```typescript
interface RetryConfig {
  maxAttempts: number;      // 3
  baseDelay: number;        // 1000ms
  maxDelay: number;         // 30000ms
  backoffMultiplier: number; // 2
}

async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  isRetryable: (error: Error) => boolean
): Promise<T> {
  let lastError: Error;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === config.maxAttempts) {
        throw error;
      }
      const delay = Math.min(
        config.baseDelay * Math.pow(config.backoffMultiplier, attempt - 1),
        config.maxDelay
      );
      await sleep(delay);
    }
  }
  throw lastError!;
}
```

### 4.3 Circuit Breaker

```typescript
interface CircuitBreakerConfig {
  failureThreshold: number;  // 5 failures
  recoveryTimeout: number;   // 60000ms
  halfOpenRequests: number;  // 1
}

class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private lastFailure?: Date;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (this.shouldAttemptRecovery()) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
}
```

---

## 5. Security Considerations

### 5.1 Input Validation

- All requests validated with Zod schemas
- File uploads: type whitelist, size limits
- Path traversal prevention for context files
- SQL injection prevention (parameterized queries)

### 5.2 Secrets Management

```typescript
// Never log secrets
const REDACTED_FIELDS = ['api_key', 'secret', 'password', 'token'];

function redactSecrets(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;

  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => {
      if (REDACTED_FIELDS.some(f => key.toLowerCase().includes(f))) {
        return [key, '[REDACTED]'];
      }
      return [key, redactSecrets(value)];
    })
  );
}
```

### 5.3 Rate Limiting

```typescript
interface RateLimitConfig {
  windowMs: number;        // 60000 (1 minute)
  maxRequests: number;     // 100
  keyGenerator: (req: Request) => string;
}

// Implementation using sliding window
class RateLimiter {
  private windows = new Map<string, number[]>();

  isAllowed(key: string): boolean {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let timestamps = this.windows.get(key) || [];
    timestamps = timestamps.filter(t => t > windowStart);

    if (timestamps.length >= this.config.maxRequests) {
      return false;
    }

    timestamps.push(now);
    this.windows.set(key, timestamps);
    return true;
  }
}
```

---

## 6. Testing Strategy

### 6.1 Unit Tests

**Location**: `tests/unit/`

**Focus**:
- Config validation
- Request/response parsing
- Routing algorithm
- Quota calculations
- Error handling

**Example**:
```typescript
describe('AccountRouter', () => {
  it('should route to session account if exists', async () => {
    const router = createAccountRouter(mockConfig);
    const result = await router.route({ sessionId: 'existing-session' });
    expect(result.reason).toBe('session_affinity');
  });

  it('should select highest quota account for new session', async () => {
    const router = createAccountRouter(mockConfig);
    const result = await router.route({});
    expect(result.accountId).toBe('high-quota-account');
  });
});
```

### 6.2 Integration Tests

**Location**: `tests/integration/`

**Focus**:
- Claude CLI execution
- Database operations
- Full request flow (without real CLI)

### 6.3 E2E Tests

**Location**: `tests/e2e/`

**Focus**:
- Full API flow
- Multi-account routing
- Batch processing
- Real Claude CLI (if available)

---

## 7. Deployment Checklist

### Pre-deployment

- [ ] All tests passing
- [ ] Config validated for target environment
- [ ] Secrets configured in environment
- [ ] Database migrations applied
- [ ] Health check endpoints working
- [ ] Metrics endpoint accessible
- [ ] Sentry DSN configured
- [ ] Langfuse credentials configured

### Post-deployment

- [ ] Health check green
- [ ] Metrics being collected
- [ ] First request successful
- [ ] Error tracking working
- [ ] Logs accessible
- [ ] Alerts configured
