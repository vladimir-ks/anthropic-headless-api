# Manual QA Testing Guide

Quick verification scenarios for human testers.

## Prerequisites

1. Server running: `bun run start`
2. Claude Code CLI installed and authenticated

## Test Scenarios

### 1. Health Check
```bash
curl http://localhost:3456/health
```
**Expected:** `{"status":"ok","version":"0.2.0",...}`

### 2. Basic Chat
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say hello"}]}'
```
**Expected:** Response with `choices[0].message.content` containing greeting

### 3. Session Continuity
```bash
# Step 1: Start conversation
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Remember: my favorite color is blue"}]}'

# Note the session_id from response

# Step 2: Continue with session_id
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"session_id":"<paste-session-id>","messages":[{"role":"user","content":"What is my favorite color?"}]}'
```
**Expected:** Response mentions "blue"

### 4. Model Selection
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Say OK"}],"model":"haiku"}'
```
**Expected:** Response with `model` field containing "haiku"

### 5. Validation - Empty Messages
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[]}'
```
**Expected:** 400 error with `"type":"invalid_request_error"`

### 6. Validation - Invalid JSON
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{invalid'
```
**Expected:** 400 error with `"code":"json_parse_error"`

### 7. Validation - Invalid Session ID Header
```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: not-a-uuid" \
  -d '{"messages":[{"role":"user","content":"Hi"}]}'
```
**Expected:** 400 error with `"code":"invalid_session_id"`

### 8. Rate Limiting
```bash
# Run 70 requests quickly (default limit is 60/min)
for i in {1..70}; do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3456/v1/chat/completions \
    -H "Content-Type: application/json" \
    -d '{"messages":[{"role":"user","content":"Hi"}]}'
done
```
**Expected:** Last requests return 429

### 9. CLI Client
```bash
./bin/claude-api1

# Type: Hello
# Expected: Response from Claude
# Type: /session
# Expected: Shows session ID
# Type: /quit
# Expected: Clean exit
```

## Log Verification

Check server logs show:
- Request: `Chat request: msgs=1, model=default, stream=false, session=new`
- Completion: `Completed: session=xxx..., tokens=X→Y, cache=Xr/Yw, cost=$X.XXXX, time=XXXms`

## Pass/Fail Criteria

| Scenario | Pass Criteria |
|----------|---------------|
| Health | Returns 200 with status:ok |
| Basic Chat | Returns 200 with content |
| Session | Second request references first |
| Model | Response model matches request |
| Validation | Returns 400 with correct error codes |
| Rate Limit | Returns 429 after limit exceeded |
| CLI | Interactive session works |
