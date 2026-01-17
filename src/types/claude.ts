/**
 * Claude Code CLI output types
 *
 * These types represent the actual JSON output from `claude -p --output-format json`
 * This is the source of truth for what Claude returns.
 */

// =============================================================================
// CLAUDE CLI JSON OUTPUT (from --output-format json)
// =============================================================================

export interface ClaudeCliJsonOutput {
  type: 'result';
  subtype: 'success' | 'error';
  is_error: boolean;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  result: string;
  session_id: string;
  total_cost_usd: number;
  usage: ClaudeUsage;
  modelUsage: Record<string, ClaudeModelUsage>;
  permission_denials: string[];
  uuid: string;
}

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  server_tool_use: {
    web_search_requests: number;
    web_fetch_requests: number;
  };
  service_tier: string;
  cache_creation?: {
    ephemeral_1h_input_tokens: number;
    ephemeral_5m_input_tokens: number;
  };
}

export interface ClaudeModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  webSearchRequests: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
}

// =============================================================================
// QUOTA API TYPES (from OAuth usage endpoint)
// =============================================================================

export interface ClaudeQuotaResponse {
  five_hour: QuotaWindow | null;
  seven_day: QuotaWindow | null;
  seven_day_oauth_apps: QuotaWindow | null;
  seven_day_opus: QuotaWindow | null;
  seven_day_sonnet: QuotaWindow | null;
  iguana_necktie: unknown | null;
  extra_usage: ExtraUsage;
}

export interface QuotaWindow {
  utilization: number; // 0-100 percentage
  resets_at: string; // ISO8601 timestamp
}

export interface ExtraUsage {
  is_enabled: boolean;
  monthly_limit: number | null;
  used_credits: number | null;
  utilization: number | null;
}

// =============================================================================
// INTERNAL EXECUTION TYPES
// =============================================================================

export interface ClaudeExecuteOptions {
  query: string;
  systemPrompt?: string;
  configDir?: string;
  sessionId?: string; // For continuing conversations
  timeout?: number;
  workingDirectory?: string;

  // === MODEL SELECTION ===
  /** Model: opus, sonnet, haiku, or full name */
  model?: string;
  /** Fallback model when primary is overloaded */
  fallbackModel?: string;

  // === TOOL CONTROL ===
  /** Tools allowed without prompting */
  allowedTools?: string[];
  /** Tools explicitly denied */
  disallowedTools?: string[];
  /** Available tools: "" (none), "default" (all), or list */
  tools?: string[] | 'default' | '';

  // === BUDGET & PERMISSIONS ===
  /** Maximum spend in USD */
  maxBudgetUsd?: number;
  /** Permission mode */
  permissionMode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'delegate' | 'dontAsk';

  // === SYSTEM PROMPT ===
  /** Append to default system prompt instead of replacing */
  appendSystemPrompt?: string;

  // === STRUCTURED OUTPUT ===
  /** JSON Schema for structured output */
  jsonSchema?: Record<string, unknown>;

  // === AGENT CONTROL ===
  /** Use specific agent */
  agent?: string;
  /** Define custom agents inline */
  agents?: Record<string, { description?: string; prompt?: string; allowed_tools?: string[] }>;

  // === SESSION CONTROL ===
  /** Continue most recent conversation */
  continueConversation?: boolean;
  /** Fork session instead of reusing */
  forkSession?: boolean;
  /** Disable session persistence */
  ephemeral?: boolean;

  // === DIRECTORY ACCESS ===
  /** Additional directories to allow */
  addDirs?: string[];

  // === MCP INTEGRATION ===
  /** MCP server configurations */
  mcpConfig?: string[];
  /** Only use specified MCP servers */
  strictMcpConfig?: boolean;

  // === ADVANCED ===
  /** Enable verbose output */
  verbose?: boolean;
  /** Beta features to enable */
  betas?: string[];
}

export interface ClaudeExecuteResult {
  success: boolean;
  output: string;
  sessionId: string | null;
  metadata: ClaudeMetadata | null;
  error?: string;
}

export interface ClaudeMetadata {
  durationMs: number;
  durationApiMs: number;
  numTurns: number;
  totalCostUsd: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
  };
  modelUsage: Record<string, ClaudeModelUsage>;
  uuid: string;
}

// =============================================================================
// ACCOUNT TYPES
// =============================================================================

export interface ClaudeAccount {
  id: string;
  name: string;
  configDir: string;
  keychainService?: string; // For OAuth token extraction
  enabled: boolean;
  priority: number; // Lower = higher priority
}

export interface AccountStatus extends ClaudeAccount {
  health: 'healthy' | 'degraded' | 'unavailable';
  lastError?: string;
  lastErrorAt?: Date;
  quota?: ClaudeQuotaResponse;
  quotaFetchedAt?: Date;
}
