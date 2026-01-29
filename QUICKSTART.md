# Quickstart: Intelligent AI Gateway

Complete guide for deploying and using the multi-backend routing system.

---

## 🚀 Quick Start (5 minutes)

### 1. Install & Setup

```bash
cd /Users/vmks/_dev_tools/anthropic-headless-api

# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Edit .env to add API keys (optional - Claude CLI works without them)
nano .env
```

### 2. Start Server

```bash
# Start with default configuration
bun run start

# Or with custom config
PORT=3456 bun run start
```

Server runs at: `http://localhost:3456`

### 3. Test Request

```bash
# Simple chat (auto-routed to cheapest backend)
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

---

## 📊 Architecture Overview

```
Request → Gateway → Smart Router → Backend Selection
                         ↓
        ┌────────────────┼────────────────┐
        │                │                │
    Claude CLI       OpenRouter        Gemini
   (tools + files)  (cost-effective)  (long context)
        │                │                │
        └────────────────┴────────────────┘
                         ↓
                  SQLite Logger
                         ↓
                  Response to Client
```

**Routing Logic:**
- **Tools required?** → Claude CLI (with process pool)
- **Simple chat?** → Cheapest API (OpenRouter, Gemini, etc.)
- **Explicit backend?** → Use specified backend
- **Queue full?** → Fallback to API (graceful degradation)

---

## 🎯 Usage Examples

### Auto-Routing (Recommended)

Gateway automatically selects optimal backend:

```bash
# Simple chat → Routes to cheapest API
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Explain quantum computing in 3 sentences"}
    ]
  }'

# Tools required → Routes to Claude CLI
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "List files in current directory"}],
    "working_directory": "/tmp",
    "tools": ["Read", "Glob"]
  }'
```

### Explicit Backend Selection

#### Via URL Path

```bash
# Use Claude CLI explicitly
curl -X POST http://localhost:3456/v1/claude-cli-default/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Use OpenRouter explicitly
curl -X POST http://localhost:3456/v1/openrouter-glm/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'

# Use Gemini explicitly
curl -X POST http://localhost:3456/v1/gemini-1.5-pro/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages": [{"role": "user", "content": "Hello"}]}'
```

#### Via Body Field

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "backend": "openrouter-glm",
    "messages": [{"role": "user", "content": "Hello"}]
  }'
```

### Working Directory & Context

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Analyze the codebase structure"}
    ],
    "working_directory": "/path/to/your/project",
    "tools": ["Read", "Glob"]
  }'
```

**What happens:**
1. Gateway routes to Claude CLI (tools required)
2. Claude reads `CONTEXT.md` from working directory
3. Claude has access to files via Read/Glob tools
4. Response includes project analysis

### Session Continuity

```bash
# First message - creates session
SESSION_ID=$(curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "My name is Alice"}]
  }' | jq -r '.session_id')

# Continue conversation with session_id
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d "{
    \"session_id\": \"$SESSION_ID\",
    \"messages\": [{\"role\": \"user\", \"content\": \"What is my name?\"}]
  }"
```

**Response:** "Your name is Alice"

### Streaming Responses

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Write a haiku about AI"}],
    "stream": true
  }'
```

Outputs Server-Sent Events (SSE):
```
data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...}
data: {"id":"chatcmpl-...","object":"chat.completion.chunk",...}
data: [DONE]
```

---

## 🔧 Configuration

### Environment Variables

```bash
# Server
PORT=3456                          # Server port
HOST=127.0.0.1                     # Server host

# Gateway
BACKENDS_CONFIG=./config/backends.json  # Backend configuration
DATABASE_PATH=./logs/requests.db        # SQLite database path
ENABLE_SQLITE_LOGGING=true              # Enable request logging

# Rate Limiting
RATE_LIMIT_MAX=60                  # Max requests per minute
RATE_LIMIT_ENABLED=true            # Enable rate limiting

# Logging
LOG_LEVEL=info                     # debug, info, warn, error

# API Keys (optional - only needed for non-CLI backends)
OPENROUTER_API_KEY=sk-or-...       # OpenRouter API key
ANTHROPIC_API_KEY=sk-ant-...       # Direct Anthropic API key
OPENAI_API_KEY=sk-...              # OpenAI API key
GOOGLE_API_KEY=...                 # Google Gemini API key
```

### Backend Configuration (`config/backends.json`)

```json
{
  "backends": [
    {
      "name": "claude-cli-default",
      "type": "claude-cli",
      "configDir": "~/.claude-inst2",
      "maxConcurrent": 10,
      "queueSize": 50,
      "timeout": 120000,
      "supportsTools": true
    },
    {
      "name": "openrouter-glm",
      "type": "api",
      "provider": "openrouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "z-ai/glm-4.7",
      "authTokenEnv": "OPENROUTER_API_KEY",
      "costPerRequest": 0.001,
      "supportsTools": false
    }
  ],
  "routing": {
    "defaultBackend": "claude-cli-default",
    "preferCheapest": true,
    "fallbackChain": [
      "claude-cli-default",
      "openrouter-glm",
      "gemini-1.5-pro"
    ]
  }
}
```

**Adding New Backends:**

1. Add entry to `backends` array
2. Set `authTokenEnv` to environment variable name
3. Add API key to `.env`
4. Restart server

---

## 📡 Monitoring & Observability

### Health Check

```bash
curl http://localhost:3456/health
```

Response:
```json
{
  "status": "ok",
  "version": "1.0.0",
  "backend": "intelligent-gateway",
  "uptime_seconds": 3600,
  "routing": {
    "processPool": {
      "active": 2,
      "queued": 0,
      "maxConcurrent": 10,
      "utilization": 0.2
    },
    "backends": {
      "total": 7,
      "tool": 3,
      "api": 4
    }
  }
}
```

### Queue Status

```bash
curl http://localhost:3456/queue/status
```

Response:
```json
{
  "processPool": {
    "active": 5,
    "queued": 2,
    "maxConcurrent": 10,
    "maxQueue": 50,
    "utilization": 0.5,
    "totalProcessed": 1234,
    "totalQueued": 45,
    "totalFailed": 3
  },
  "backends": {
    "total": 7,
    "tool": 3,
    "api": 4
  }
}
```

### SQLite Analytics

```bash
# Query recent requests
sqlite3 logs/requests.db "SELECT id, backend, duration_ms, cost_usd FROM requests ORDER BY timestamp DESC LIMIT 10;"

# Backend usage
sqlite3 logs/requests.db "SELECT backend, COUNT(*) as count FROM requests GROUP BY backend;"

# Cost analysis
sqlite3 logs/requests.db "SELECT backend, SUM(cost_usd) as total_cost FROM requests GROUP BY backend;"

# Degraded requests (fallback mode)
sqlite3 logs/requests.db "SELECT COUNT(*) FROM requests WHERE degraded = 1;"

# Error rate
sqlite3 logs/requests.db "SELECT COUNT(*) as errors FROM requests WHERE error IS NOT NULL;"
```

---

## 🐍 Python SDK Example

```python
from openai import OpenAI

# Initialize client
client = OpenAI(
    base_url="http://localhost:3456/v1",
    api_key="not-needed-for-local"  # No auth required for localhost
)

# Auto-routing (gateway decides)
response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[
        {"role": "user", "content": "Hello!"}
    ]
)
print(response.choices[0].message.content)

# Explicit backend selection
response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[
        {"role": "user", "content": "Hello!"}
    ],
    extra_body={"backend": "openrouter-glm"}
)
```

---

## ⚙️ Advanced Configuration

### Multiple Claude CLI Instances

Add to `config/backends.json`:

```json
{
  "name": "claude-cli-kimi",
  "type": "claude-cli",
  "configDir": "~/.claude-inst10",
  "maxConcurrent": 5,
  "queueSize": 25,
  "timeout": 120000,
  "supportsTools": true,
  "description": "Kimi K2 via Moonshot API"
}
```

Requires `~/.claude-inst10` with Moonshot API configuration.

### Process Pool Tuning

**For high-traffic scenarios:**

```json
{
  "maxConcurrent": 20,  // Allow more parallel processes
  "queueSize": 100,     // Larger queue
  "timeout": 180000     // 3 minutes timeout
}
```

**For resource-constrained systems:**

```json
{
  "maxConcurrent": 5,   // Limit parallel processes
  "queueSize": 20,      // Smaller queue
  "timeout": 60000      // 1 minute timeout
}
```

### Custom Fallback Chain

```json
{
  "routing": {
    "defaultBackend": "claude-cli-default",
    "preferCheapest": false,  // Prefer quality over cost
    "fallbackChain": [
      "anthropic-api-sonnet",  // Try direct API first
      "claude-cli-default",    // Then Claude CLI
      "openrouter-glm"         // Finally cheapest
    ]
  }
}
```

---

## 🔍 Troubleshooting

### Backend Unavailable

**Symptom:** `No backends currently available`

**Solutions:**
1. Check API keys in `.env`
2. Verify network connectivity
3. Run health check: `curl http://localhost:3456/health`
4. Check logs for specific error

### Queue Full

**Symptom:** `Process pool queue full`

**Solutions:**
1. Increase `maxQueue` in `backends.json`
2. Add more Claude CLI backends
3. Enable fallback to API backends
4. Check for stuck processes: `curl http://localhost:3456/queue/status`

### High Latency

**Symptom:** Slow responses

**Solutions:**
1. Check queue utilization
2. Use API backends for simple requests
3. Increase `maxConcurrent` for Claude CLI
4. Monitor with: `sqlite3 logs/requests.db "SELECT AVG(duration_ms) FROM requests;"`

### TypeScript Errors

```bash
# Run type checking
bunx tsc --noEmit

# Common fixes
bun install  # Update dependencies
```

---

## 🎓 Best Practices

### 1. Cost Optimization

- Use auto-routing for most requests (gateway selects cheapest)
- Reserve Claude CLI for tool-use only
- Monitor costs: `SELECT SUM(cost_usd) FROM requests;`

### 2. Resource Management

- Start with default limits (maxConcurrent: 10)
- Monitor utilization: `/queue/status`
- Scale up only when needed (>80% utilization)

### 3. Error Handling

- Always check response status
- Handle degraded mode gracefully (response.degraded flag)
- Implement retry logic with exponential backoff

### 4. Security

- Use `API_AUTH_TOKEN` for remote deployments
- Restrict working_directory to safe paths
- Never expose API keys in client code

### 5. Monitoring

- Query SQLite regularly for analytics
- Set up alerts for high error rates
- Monitor cost trends over time

---

## 📚 Additional Resources

- **Configuration:** See `config/backends.json` for all options
- **API Reference:** OpenAI-compatible, see OpenAI docs
- **Architecture:** See plan at `.claude-inst2/plans/drifting-snacking-chipmunk.md`
- **Logs:** SQLite database at `logs/requests.db`

---

## 🆘 Support

**Issues:** [GitHub Issues](https://github.com/your-org/anthropic-headless-api/issues)

**Logs Location:**
- Server logs: `stdout/stderr`
- Request logs: `logs/requests.db` (SQLite)
- TypeScript errors: `bunx tsc --noEmit`

---

## ✅ Quick Reference

| Task | Command |
|------|---------|
| Start server | `bun run start` |
| Health check | `curl http://localhost:3456/health` |
| Queue status | `curl http://localhost:3456/queue/status` |
| Type check | `bunx tsc --noEmit` |
| View logs | `sqlite3 logs/requests.db "SELECT * FROM requests LIMIT 10;"` |
| Test request | `curl -X POST http://localhost:3456/v1/chat/completions -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"test"}]}'` |

---

**Ready to deploy!** 🚀
