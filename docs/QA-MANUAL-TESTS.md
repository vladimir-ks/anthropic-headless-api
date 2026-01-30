# Manual QA Test Scenarios

## Prerequisites
- Server running: `bun run start`
- Claude Code CLI installed and authenticated

## Test Scenarios

### 1. Basic Health Check
```bash
curl http://localhost:3456/health
```
**Expected**: JSON with `status: "ok"`, version, uptime

### 2. Simple Chat Completion
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hello"}]}'
```
**Expected**: 200 OK, response with assistant message

### 3. Session Continuity
```bash
# First request
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Remember: the password is TIGER"}]}'
# Note the session_id from response

# Second request with session_id
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"session_id":"<SESSION_ID>","messages":[{"role":"user","content":"What was the password?"}]}'
```
**Expected**: Claude recalls "TIGER" from session context

### 4. Invalid Request Validation
```bash
# Missing messages
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{}'
```
**Expected**: 400 Bad Request with validation error

### 5. Invalid Session ID Format
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi"}],"session_id":"not@valid!id"}'
```
**Expected**: 400 Bad Request, invalid session_id format

### 6. Path Traversal Prevention
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hi"}],"context_files":["../../etc/passwd"]}'
```
**Expected**: 400 Bad Request, path traversal blocked

### 7. Rate Limiting
```bash
# Run in rapid succession
for i in {1..100}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3456/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Hi"}]}'
done
```
**Expected**: After ~60 requests, receive 429 Too Many Requests

### 8. Models Endpoint
```bash
curl http://localhost:3456/v1/models
```
**Expected**: JSON array with available models

### 9. Queue Status
```bash
curl http://localhost:3456/queue/status
```
**Expected**: JSON with process pool stats

### 10. CORS Headers
```bash
curl -I -X OPTIONS http://localhost:3456/v1/chat/completions
```
**Expected**: Access-Control-Allow-Origin header present

## Security Verification

### Path Traversal Tests
All should return 400:
- `context_files: ["../secret.txt"]`
- `working_directory: "/etc"`
- `add_dirs: ["/var/log"]`

### Array Bounds Tests
Should return 400 when exceeding limits:
- `context_files` > 100 items
- `allowed_tools` > 50 items
- `messages` > 1000 items

## Performance Baselines

| Endpoint | Expected Latency |
|----------|------------------|
| GET /health | < 10ms |
| GET /v1/models | < 10ms |
| POST /v1/chat/completions (validation only) | < 50ms |
| POST /v1/chat/completions (with Claude) | 1-30s |

## Regression Checklist
- [ ] Health endpoint returns correct version
- [ ] Session continuity works across requests
- [ ] Invalid requests return proper error codes
- [ ] Rate limiting activates at threshold
- [ ] Path traversal is blocked
- [ ] CORS headers are present
