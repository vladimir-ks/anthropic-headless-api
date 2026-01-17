/**
 * OpenAI-compatible API types for anthropic-headless-api
 *
 * These contracts ensure compatibility with:
 * - OpenCode
 * - Any OpenAI-compatible client
 * - LiteLLM
 * - Other LLM tools expecting OpenAI format
 *
 * EXTENDED with anthropic-headless-api specific fields:
 * - session_id for conversation continuity
 * - claude_metadata for rich execution info
 */

import type { ClaudeMetadata } from './claude';

// =============================================================================
// REQUEST TYPES
// =============================================================================

export interface ChatCompletionRequest {
  /** Model identifier: opus, sonnet, haiku, or full model name */
  model?: string;

  /** Array of messages in the conversation */
  messages: ChatMessage[];

  /** Maximum tokens to generate (passed to Claude) */
  max_tokens?: number;

  /** Temperature for response randomness */
  temperature?: number;

  /** Enable streaming responses */
  stream?: boolean;

  /** System prompt override (optional - uses CONTEXT.md if not provided) */
  system?: string;

  /** Working directory for context (defaults to cwd) */
  working_directory?: string;

  /** Additional context files to include */
  context_files?: string[];

  /**
   * Session ID for continuing a conversation
   * - If provided, continues the existing session
   * - If omitted, creates a new session
   * - Returned in response for subsequent requests
   */
  session_id?: string;

  // === TOOL CONTROL ===

  /**
   * Tools allowed without prompting (e.g. ["Read","Edit","Bash"])
   * Maps to --allowedTools CLI flag
   */
  allowed_tools?: string[];

  /**
   * Tools explicitly denied (e.g. ["Write","Bash"])
   * Maps to --disallowedTools CLI flag
   */
  disallowed_tools?: string[];

  /**
   * Specify available tools from built-in set
   * "" = disable all, "default" = all tools, or list like ["Bash","Edit","Read"]
   * Maps to --tools CLI flag
   */
  tools?: string[] | 'default' | '';

  // === BUDGET & PERMISSIONS ===

  /**
   * Maximum spend in USD for this request
   * Maps to --max-budget-usd CLI flag
   */
  max_budget_usd?: number;

  /**
   * Permission mode for the session
   * Maps to --permission-mode CLI flag
   */
  permission_mode?: 'default' | 'plan' | 'acceptEdits' | 'bypassPermissions' | 'delegate' | 'dontAsk';

  // === SYSTEM PROMPT CONTROL ===

  /**
   * Append to the default system prompt instead of replacing
   * Maps to --append-system-prompt CLI flag
   */
  append_system_prompt?: string;

  // === STRUCTURED OUTPUT ===

  /**
   * JSON Schema for structured output validation
   * Maps to --json-schema CLI flag
   * Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}
   */
  json_schema?: Record<string, unknown>;

  // === AGENT CONTROL ===

  /**
   * Use a specific agent for this session
   * Maps to --agent CLI flag
   */
  agent?: string;

  /**
   * Define custom agents inline as JSON
   * Maps to --agents CLI flag
   * Example: {"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}
   */
  agents?: Record<string, { description?: string; prompt?: string; allowed_tools?: string[] }>;

  // === SESSION CONTROL ===

  /**
   * Continue the most recent conversation (alternative to session_id)
   * Maps to -c/--continue CLI flag
   */
  continue_conversation?: boolean;

  /**
   * Fork session instead of reusing when resuming
   * Maps to --fork-session CLI flag
   */
  fork_session?: boolean;

  /**
   * Disable session persistence (ephemeral mode)
   * Maps to --no-session-persistence CLI flag
   */
  ephemeral?: boolean;

  // === DIRECTORY ACCESS ===

  /**
   * Additional directories to allow tool access to
   * Maps to --add-dir CLI flag
   */
  add_dirs?: string[];

  // === RESILIENCE ===

  /**
   * Fallback model when primary is overloaded
   * Maps to --fallback-model CLI flag
   */
  fallback_model?: string;

  // === MCP INTEGRATION ===

  /**
   * MCP server configuration (JSON strings or file paths)
   * Maps to --mcp-config CLI flag
   */
  mcp_config?: string[];

  /**
   * Only use specified MCP servers, ignore all others
   * Maps to --strict-mcp-config CLI flag
   */
  strict_mcp_config?: boolean;

  // === ADVANCED ===

  /**
   * Enable verbose output (required for stream-json)
   * Maps to --verbose CLI flag
   */
  verbose?: boolean;

  /**
   * Beta features to enable (API key users only)
   * Maps to --betas CLI flag
   */
  betas?: string[];
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  name?: string;
}

// =============================================================================
// RESPONSE TYPES
// =============================================================================

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: UsageInfo;

  /**
   * Session ID for conversation continuity
   * Pass this back in subsequent requests to continue the conversation
   */
  session_id?: string;

  /**
   * Rich metadata from Claude CLI execution
   * Includes cost, timing, and detailed token usage
   */
  claude_metadata?: ClaudeMetadata;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Tokens read from Claude's prompt cache (cheaper) */
  cache_read_tokens?: number;
  /** Tokens written to Claude's prompt cache */
  cache_creation_tokens?: number;
}

// =============================================================================
// STREAMING TYPES
// =============================================================================

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: ChatCompletionChunkChoice[];
  /** Session ID included in final chunk */
  session_id?: string;
}

export interface ChatCompletionChunkChoice {
  index: number;
  delta: Partial<ChatMessage>;
  finish_reason: 'stop' | 'length' | 'content_filter' | null;
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export interface APIError {
  error: {
    message: string;
    type: 'invalid_request_error' | 'authentication_error' | 'rate_limit_error' | 'server_error';
    code: string | null;
    /** Additional error details */
    details?: Record<string, unknown>;
  };
}

// =============================================================================
// SERVER CONFIGURATION
// =============================================================================

export interface ServerConfig {
  port: number;
  host: string;
  claudeConfigDir?: string;
  defaultSystemPrompt?: string;
  contextFileName: string;
  enableCors: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';

  /** Rate limiting configuration */
  rateLimit?: RateLimitConfig;
}

export interface RateLimitConfig {
  /** Maximum requests per window */
  maxRequests: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Whether to enable rate limiting */
  enabled: boolean;
}

// =============================================================================
// CONTEXT TYPES
// =============================================================================

export interface ContextInfo {
  contextMd: string | null;
  directoryContents: string[];
  workingDirectory: string;
}

// =============================================================================
// DEPRECATED TYPES (kept for backwards compatibility)
// =============================================================================

/** @deprecated Use ClaudeExecuteOptions from ./claude.ts */
export interface ClaudeCliOptions {
  systemPrompt: string;
  configDir?: string;
  timeout?: number;
}

/** @deprecated Use ClaudeExecuteResult from ./claude.ts */
export interface ClaudeCliResult {
  success: boolean;
  output: string;
  error?: string;
}
