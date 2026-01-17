---
metadata:
  modules: [anthropic-headless-api, claude-cli]
  tldr: "Complete Claude Code CLI headless mode reference with all flags, env vars, and integration plan"
  dependencies: []
  code_refs: [src/lib/claude-cli.ts]
---

# Claude Code CLI Headless Mode Reference

## Deployment Requirements

### Minimum Requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | 256MB | 512MB |
| CPU | 1 core | 2 cores |
| Disk | 100MB | 500MB (for sessions) |
| Node.js/Bun | Bun 1.0+ or Node 18+ | Bun 1.2+ |

### Platform Support

| Platform | Status | Notes |
|----------|--------|-------|
| macOS | Supported | Native, tested |
| Linux | Supported | x64 and arm64 |
| Windows | Supported | WSL2 recommended |
| Docker | Supported | Requires ANTHROPIC_API_KEY |

### Daemon Deployment

**macOS (launchd):**
```xml
<!-- ~/Library/LaunchAgents/com.anthropic-headless-api.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.anthropic-headless-api</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/bun</string>
        <string>run</string>
        <string>/path/to/anthropic-headless-api/src/index.ts</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PORT</key>
        <string>3456</string>
    </dict>
</dict>
</plist>
```

**Linux (systemd):**
```ini
# /etc/systemd/system/anthropic-headless-api.service
[Unit]
Description=Anthropic Headless API
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/anthropic-headless-api
ExecStart=/usr/bin/bun run src/index.ts
Restart=always
Environment=PORT=3456

[Install]
WantedBy=multi-user.target
```

**Windows (NSSM):**
```powershell
# Install NSSM, then:
nssm install anthropic-headless-api "C:\path\to\bun.exe" "run src/index.ts"
nssm set anthropic-headless-api AppDirectory "C:\path\to\anthropic-headless-api"
nssm set anthropic-headless-api AppEnvironmentExtra "PORT=3456"
```

---

## Resource Limits & Breakers

### Built-in Protections

| Protection | Default | Configurable |
|------------|---------|--------------|
| Rate limiting | 60 req/min | RATE_LIMIT_MAX |
| Request timeout | 120 seconds | In code |
| Graceful shutdown | SIGINT/SIGTERM | Automatic |
| Memory cleanup | Every 60s | Rate limiter |

### CLI Budget Control

```bash
# Limit spend per request
claude -p --max-budget-usd 0.50 "Your query"
```

### Session Persistence Control

```bash
# Disable session storage (ephemeral mode)
claude -p --no-session-persistence "Your query"
```

### Peak Load Estimates

| Scenario | Requests/min | Memory | Notes |
|----------|-------------|--------|-------|
| Light | 10-20 | 256MB | Simple queries |
| Medium | 30-50 | 512MB | Mixed queries |
| Heavy | 60+ | 1GB+ | Tool-heavy, subagents |

**Note:** Each request spawns a Claude CLI process (~50-100MB). Concurrent requests multiply this.

---

## CLI Flags Reference

### Session Management

| Flag | New Session | Resume Session | Description |
|------|-------------|----------------|-------------|
| `--session-id <uuid>` | Sets custom ID | N/A | Use specific session ID |
| `--resume <id>` | N/A | Required | Resume session by ID |
| `-c, --continue` | N/A | Uses latest | Continue most recent session |
| `--fork-session` | N/A | Creates new | Fork instead of reuse |
| `--no-session-persistence` | Disables | N/A | Don't save session to disk |

### Model Selection

| Flag | Description |
|------|-------------|
| `--model <model>` | Set model: `opus`, `sonnet`, `haiku`, or full name |
| `--fallback-model <model>` | Fallback when primary overloaded |

**Model aliases:**
- `opus` → claude-opus-4-5-20251101
- `sonnet` → claude-sonnet-4-5-20250929
- `haiku` → claude-haiku-4-5-20251001

### Output Control

| Flag | Description |
|------|-------------|
| `--output-format text` | Plain text (default) |
| `--output-format json` | Single JSON result with metadata |
| `--output-format stream-json` | Newline-delimited JSON stream |
| `--json-schema <schema>` | Enforce output structure |
| `--verbose` | Required for stream-json |
| `--include-partial-messages` | Include partial chunks (stream-json) |

### Input Control

| Flag | Description |
|------|-------------|
| `--input-format text` | Plain text (default) |
| `--input-format stream-json` | Realtime streaming input |
| `--replay-user-messages` | Echo user messages back |

### System Prompt

| Flag | Description |
|------|-------------|
| `--system-prompt <prompt>` | Override system prompt entirely |
| `--append-system-prompt <prompt>` | Append to default system prompt |

### Tool Control

| Flag | Description |
|------|-------------|
| `--tools <tools>` | Available tools: `""` (none), `default` (all), or list |
| `--allowedTools <tools>` | Tools allowed without prompting |
| `--disallowedTools <tools>` | Tools explicitly denied |

**Tool examples:**
```bash
# Only allow read operations
claude -p --tools "Read,Glob,Grep" "Search for X"

# Allow bash but only git commands
claude -p --allowedTools "Bash(git:*)" "Check git status"

# Disable all tools (pure chat)
claude -p --tools "" "What is 2+2?"
```

### Permission Modes

| Flag Value | Description |
|------------|-------------|
| `default` | Normal prompting |
| `plan` | Read-only planning mode |
| `acceptEdits` | Auto-approve file edits |
| `dontAsk` | Don't prompt for permissions |
| `bypassPermissions` | Skip all checks |
| `delegate` | Delegate to subagents |

### Agent & Plugin Control

| Flag | Description |
|------|-------------|
| `--agent <agent>` | Use specific agent |
| `--agents <json>` | Define custom agents inline |
| `--plugin-dir <paths>` | Load plugins from directories |
| `--disable-slash-commands` | Disable all skills |

### MCP Configuration

| Flag | Description |
|------|-------------|
| `--mcp-config <configs>` | Load MCP servers |
| `--strict-mcp-config` | Only use specified MCP servers |

### Budget & Limits

| Flag | Description |
|------|-------------|
| `--max-budget-usd <amount>` | Maximum spend per request |

### Directory Access

| Flag | Description |
|------|-------------|
| `--add-dir <directories>` | Additional allowed directories |

### Settings Override

| Flag | Description |
|------|-------------|
| `--settings <file-or-json>` | Load additional settings |
| `--setting-sources <sources>` | Which settings to load (user,project,local) |

---

## Environment Variables

### Authentication

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key (bypasses OAuth) |
| `CLAUDE_CONFIG_DIR` | Config directory (sessions, settings) |

### Model Configuration

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_MODEL` | Default model |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | Map opus alias |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | Map sonnet alias |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | Map haiku alias |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model for subagents |

### Prompt Caching Control

| Variable | Description |
|----------|-------------|
| `DISABLE_PROMPT_CACHING=1` | Disable all caching |
| `DISABLE_PROMPT_CACHING_HAIKU=1` | Disable for Haiku |
| `DISABLE_PROMPT_CACHING_SONNET=1` | Disable for Sonnet |
| `DISABLE_PROMPT_CACHING_OPUS=1` | Disable for Opus |

### Behavior Control

| Variable | Description |
|----------|-------------|
| `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR=1` | Reset cwd after bash |
| `CLAUDE_ENV_FILE` | Shell config to source |
| `CLAUDE_CODE_ENTRYPOINT` | Entry point type |

---

## Variables: New Session vs Resumed Session

### New Session Only

| Flag/Variable | Why |
|---------------|-----|
| `--system-prompt` | Sets initial context |
| `--append-system-prompt` | Adds to initial context |
| `--session-id` | Sets custom ID |
| `--json-schema` | Defines output structure |
| `--agents` | Defines available agents |
| `--mcp-config` | Configures MCP servers |
| `--add-dir` | Sets allowed directories |
| CONTEXT.md reading | Initial context injection |

### Both New & Resumed

| Flag/Variable | Notes |
|---------------|-------|
| `--model` | Can change model per request |
| `--output-format` | Output format per request |
| `--tools` | Tool availability per request |
| `--allowedTools` | Permission scope per request |
| `--max-budget-usd` | Budget per request |
| `--verbose` | Output detail per request |
| `--permission-mode` | Permission handling per request |

### Resume Only

| Flag/Variable | Description |
|---------------|-------------|
| `--resume <id>` | Required to resume |
| `-c, --continue` | Resume most recent |
| `--fork-session` | Fork instead of reuse |

### Can You Switch Models Mid-Conversation?

**Yes.** Each request can specify a different model:

```bash
# Start with Sonnet
RESULT=$(claude -p --model sonnet --output-format json "Hello, remember X")
SESSION=$(echo $RESULT | jq -r '.session_id')

# Continue with Opus
claude -p --model opus --resume $SESSION --output-format json "What was X?"
```

**Caveats:**
- Context is maintained across model switches
- Different models have different capabilities
- Cost varies significantly between models

---

## JSON Output Structure

### Basic JSON (`--output-format json`)

```json
{
  "type": "result",
  "subtype": "success",
  "is_error": false,
  "duration_ms": 2998,
  "duration_api_ms": 4275,
  "num_turns": 1,
  "result": "Response text here",
  "session_id": "uuid-here",
  "total_cost_usd": 0.134228,
  "usage": {
    "input_tokens": 2,
    "cache_creation_input_tokens": 21396,
    "cache_read_input_tokens": 0,
    "output_tokens": 5,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    }
  },
  "modelUsage": {
    "claude-opus-4-5-20251101": {
      "inputTokens": 2,
      "outputTokens": 5,
      "cacheReadInputTokens": 0,
      "cacheCreationInputTokens": 21396,
      "costUSD": 0.134
    }
  },
  "permission_denials": [],
  "uuid": "unique-execution-id"
}
```

### Stream JSON (`--output-format stream-json --verbose`)

Each line is a JSON object:

```json
{"type":"system","subtype":"init","session_id":"...","tools":[...],"model":"..."}
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read","input":{...}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","content":"..."}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"result","subtype":"success","session_id":"...","total_cost_usd":...}
```

---

## Tool Use Visibility

### In Stream JSON

Tool invocations are fully visible:

```json
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "id": "toolu_xxx",
      "name": "Read",
      "input": {"file_path": "/path/to/file"}
    }]
  }
}
```

Tool results:

```json
{
  "type": "user",
  "message": {
    "content": [{
      "type": "tool_result",
      "tool_use_id": "toolu_xxx",
      "content": "file contents here"
    }]
  },
  "tool_use_result": {
    "type": "text",
    "file": {"filePath": "...", "content": "..."}
  }
}
```

### Subagent (Task Tool) Visibility

```json
{
  "type": "assistant",
  "message": {
    "content": [{
      "type": "tool_use",
      "name": "Task",
      "input": {
        "description": "...",
        "prompt": "...",
        "subagent_type": "Explore"
      }
    }]
  }
}
```

Subagent actions shown with `parent_tool_use_id`:

```json
{
  "type": "assistant",
  "message": {...},
  "parent_tool_use_id": "toolu_xxx"  // Links to parent Task
}
```

Subagent result includes metadata:

```json
{
  "tool_use_result": {
    "status": "completed",
    "agentId": "abc123",
    "totalDurationMs": 6363,
    "totalTokens": 12095,
    "totalToolUseCount": 1
  }
}
```

---

## Integration Plan for anthropic-headless-api

### Phase 1: Current (Implemented)

- Basic `-p` mode with `--output-format json`
- Session continuity via `--resume`
- CONTEXT.md reading for new sessions
- Rate limiting protection

### Phase 2: Enhanced Output (Recommended)

| Feature | Implementation |
|---------|----------------|
| Stream JSON support | Use `--output-format stream-json --verbose` |
| Tool use visibility | Parse stream for tool_use messages |
| Subagent tracking | Track parent_tool_use_id |
| Real-time streaming | Forward stream chunks to client |

### Phase 3: Advanced Features

| Feature | CLI Flags |
|---------|-----------|
| Model selection | `--model <model>` in request |
| Tool restrictions | `--tools`, `--allowedTools` |
| Budget control | `--max-budget-usd` |
| Custom agents | `--agents <json>` |
| Output schema | `--json-schema <schema>` |

### API Extensions Needed

```typescript
interface ChatCompletionRequest {
  // Existing fields...

  // Phase 2
  stream_tool_use?: boolean;  // Include tool use in stream

  // Phase 3
  model?: 'opus' | 'sonnet' | 'haiku' | string;
  allowed_tools?: string[];
  disallowed_tools?: string[];
  max_budget_usd?: number;
  output_schema?: object;  // JSON Schema
  permission_mode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions';
  agents?: Record<string, AgentDefinition>;
}

interface ChatCompletionChunk {
  // Existing fields...

  // Tool use visibility
  tool_use?: {
    id: string;
    name: string;
    input: unknown;
  };
  tool_result?: {
    tool_use_id: string;
    content: string;
  };
}
```

### Connecting to Custom Claude Configurations

**Use CLAUDE_CONFIG_DIR:**
```bash
# Different config directories for different use cases
CLAUDE_CONFIG_DIR=~/.claude-medical bun run start
CLAUDE_CONFIG_DIR=~/.claude-coding bun run start
```

**Per-request configuration:**
```typescript
// In request body
{
  "config_dir": "~/.claude-medical",
  // OR pass via header
  // X-Claude-Config-Dir: ~/.claude-medical
}
```

**Custom settings per config:**
```json
// ~/.claude-medical/settings.json
{
  "model": "opus",
  "systemPrompt": "You are a medical assistant...",
  "allowedTools": ["Read", "WebSearch"]
}
```

---

## Summary

| Question | Answer |
|----------|--------|
| Ready for testing? | Yes |
| Daemon deployment? | Yes (launchd, systemd, NSSM) |
| Resource limits? | Rate limiting, budget control |
| Tool use visible? | Yes, in stream-json mode |
| Subagents visible? | Yes, with parent_tool_use_id |
| Model switching? | Yes, per-request |
| Custom configs? | Yes, via CLAUDE_CONFIG_DIR |
