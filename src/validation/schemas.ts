/**
 * Zod validation schemas for API requests
 *
 * Provides runtime type validation with descriptive error messages.
 * Used at API boundaries to catch malformed requests early.
 */

import { z } from 'zod';

// =============================================================================
// MESSAGE SCHEMAS
// =============================================================================

export const ChatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant'], {
    error: 'Role must be "system", "user", or "assistant"',
  }),
  content: z.string().min(1, 'Message content cannot be empty'),
  name: z.string().optional(),
});

export type ValidatedChatMessage = z.infer<typeof ChatMessageSchema>;

// =============================================================================
// REQUEST SCHEMAS
// =============================================================================

export const ChatCompletionRequestSchema = z
  .object({
    // Model: opus, sonnet, haiku, or full model name
    model: z
      .string()
      .refine(
        (m) => {
          if (!m) return true; // Optional field
          // Allow short names or full model names starting with "claude-"
          return /^(opus|sonnet|haiku|claude-.+)$/i.test(m);
        },
        {
          message: 'Model must be "opus", "sonnet", "haiku", or a full Claude model name (claude-*)',
        }
      )
      .optional(),

    // Messages array - required
    messages: z
      .array(ChatMessageSchema)
      .min(1, 'Messages array cannot be empty')
      .refine((messages) => messages.some((m) => m.role === 'user'), {
        message: 'At least one user message is required',
      }),

    // Generation parameters
    max_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),

    // Streaming
    stream: z.boolean().optional().default(false),

    // System prompt override
    system: z.string().optional(),

    // Working directory for context
    working_directory: z
      .string()
      .refine(
        (path) => !path.includes('..'),
        { message: 'working_directory cannot contain path traversal (..)' }
      )
      .optional(),

    // Additional context files
    context_files: z
      .array(
        z.string().refine(
          (path) => !path.includes('..') && !path.startsWith('/etc') && !path.startsWith('/var'),
          { message: 'context_files cannot contain path traversal or access system directories' }
        )
      )
      .max(100, 'context_files cannot exceed 100 files')
      .optional(),

    // Session ID for conversation continuity
    // Allow alphanumeric with hyphens (UUID format or other session ID formats)
    session_id: z.string().regex(/^[a-zA-Z0-9\-]+$/).optional(),

    // === TOOL CONTROL ===
    allowed_tools: z.array(z.string()).max(50, 'allowed_tools cannot exceed 50 tools').optional(),
    disallowed_tools: z.array(z.string()).max(50, 'disallowed_tools cannot exceed 50 tools').optional(),
    tools: z.union([z.array(z.string()).max(50), z.literal('default'), z.literal('')]).optional(),

    // === BUDGET & PERMISSIONS ===
    max_budget_usd: z.number().positive().optional(),
    permission_mode: z
      .enum(['default', 'plan', 'acceptEdits', 'bypassPermissions', 'delegate', 'dontAsk'])
      .optional(),

    // === SYSTEM PROMPT ===
    append_system_prompt: z.string().optional(),

    // === STRUCTURED OUTPUT ===
    // Basic JSON Schema structure validation (not full JSON Schema spec compliance)
    json_schema: z
      .object({
        type: z.enum(['object', 'array', 'string', 'number', 'boolean', 'null']).optional(),
        properties: z.record(z.string(), z.unknown()).optional(),
        items: z.unknown().optional(),
        required: z.array(z.string()).optional(),
        description: z.string().optional(),
      })
      .passthrough() // Allow additional JSON Schema fields
      .optional(),

    // === AGENT CONTROL ===
    agent: z.string().optional(),
    agents: z
      .record(
        z.string(),
        z.object({
          description: z.string().optional(),
          prompt: z.string().optional(),
          allowed_tools: z.array(z.string()).optional(),
        })
      )
      .optional(),

    // === SESSION CONTROL ===
    continue_conversation: z.boolean().optional(),
    fork_session: z.boolean().optional(),
    ephemeral: z.boolean().optional(),

    // === DIRECTORY ACCESS ===
    add_dirs: z
      .array(
        z.string().refine(
          (path) => !path.includes('..') && !path.startsWith('/etc') && !path.startsWith('/var'),
          { message: 'add_dirs cannot contain path traversal or access system directories' }
        )
      )
      .max(20, 'add_dirs cannot exceed 20 directories')
      .optional(),

    // === RESILIENCE ===
    fallback_model: z.string().optional(),

    // === MCP INTEGRATION ===
    mcp_config: z.array(z.string()).max(20, 'mcp_config cannot exceed 20 items').optional(),
    strict_mcp_config: z.boolean().optional(),

    // === ADVANCED ===
    verbose: z.boolean().optional(),
    betas: z.array(z.string()).max(10, 'betas cannot exceed 10 beta features').optional(),
  })
  .strict(); // Reject unknown fields

export type ValidatedChatCompletionRequest = z.infer<typeof ChatCompletionRequestSchema>;

// Lenient version that allows unknown fields (for OpenAI compatibility)
export const ChatCompletionRequestSchemaLenient = ChatCompletionRequestSchema.strip();

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  errors?: ValidationError[];
}

export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate chat completion request
 */
export function validateChatCompletionRequest(
  data: unknown,
  strict: boolean = false
): ValidationResult<ValidatedChatCompletionRequest> {
  const schema = strict ? ChatCompletionRequestSchema : ChatCompletionRequestSchemaLenient;
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors: ValidationError[] = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || 'root',
    message: issue.message,
  }));

  return { success: false, errors };
}

/**
 * Format validation errors for API response
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  if (errors.length === 1) {
    return errors[0].message;
  }

  return errors.map((e) => `${e.field}: ${e.message}`).join('; ');
}

// =============================================================================
// RATE LIMIT CONFIG SCHEMA
// =============================================================================

export const RateLimitConfigSchema = z.object({
  maxRequests: z.number().int().positive().default(60),
  windowMs: z.number().int().positive().default(60_000),
  enabled: z.boolean().default(true),
});

// =============================================================================
// SERVER CONFIG SCHEMA
// =============================================================================

export const ServerConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(3456),
  host: z.string().default('127.0.0.1'),
  claudeConfigDir: z.string().optional(),
  defaultSystemPrompt: z.string().default(''),
  contextFileName: z.string().default('CONTEXT.md'),
  enableCors: z.boolean().default(true),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  rateLimit: RateLimitConfigSchema.optional(),
});

export type ValidatedServerConfig = z.infer<typeof ServerConfigSchema>;

/**
 * Validate and load server config from environment
 */
export function validateServerConfig(): ValidatedServerConfig {
  const raw = {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    host: process.env.HOST,
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    defaultSystemPrompt: process.env.DEFAULT_SYSTEM_PROMPT,
    contextFileName: process.env.CONTEXT_FILENAME,
    enableCors: process.env.ENABLE_CORS !== 'false',
    logLevel: process.env.LOG_LEVEL,
    rateLimit: {
      maxRequests: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : undefined,
      windowMs: 60_000,
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    },
  };

  return ServerConfigSchema.parse(raw);
}
