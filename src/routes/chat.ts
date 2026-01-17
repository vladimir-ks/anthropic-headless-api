/**
 * Chat completions route handler
 *
 * Implements OpenAI-compatible /v1/chat/completions endpoint
 * with session support for conversation continuity.
 *
 * CONVERSATION FLOW:
 * 1. Client sends request (optionally with session_id)
 * 2. If session_id provided: Claude resumes that session
 * 3. If no session_id: Claude creates new session
 * 4. Response includes session_id for subsequent requests
 * 5. Client stores session_id and passes it in next request
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatCompletionChunk,
  APIError,
  ServerConfig,
} from '../types/api';
import { executeClaudeQuery, buildPromptWithHistory } from '../lib/claude-cli';
import { readContextFromDirectory, buildContextString } from '../lib/context-reader';
import {
  validateChatCompletionRequest,
  formatValidationErrors,
} from '../validation/schemas';

/**
 * Generate a unique completion ID using cryptographic randomness
 */
function generateCompletionId(): string {
  return `chatcmpl-${crypto.randomUUID()}`;
}

/**
 * Handle chat completion request
 */
export async function handleChatCompletion(
  request: ChatCompletionRequest,
  config: ServerConfig
): Promise<ChatCompletionResponse | APIError> {
  // Validate request with Zod schema
  const validation = validateChatCompletionRequest(request);
  if (!validation.success) {
    return {
      error: {
        message: formatValidationErrors(validation.errors || []),
        type: 'invalid_request_error',
        code: 'validation_error',
        details: { errors: validation.errors },
      },
    };
  }

  // Determine working directory
  const workingDir = request.working_directory || process.cwd();

  // Read context from directory (only for new sessions)
  let contextString = '';
  if (!request.session_id) {
    const contextInfo = await readContextFromDirectory(workingDir, config.contextFileName);
    contextString = buildContextString(contextInfo);
  }

  // Extract system prompt from messages or use default
  let systemPrompt = config.defaultSystemPrompt || '';
  const systemMessage = request.messages.find((m) => m.role === 'system');
  if (systemMessage) {
    systemPrompt = systemMessage.content;
  } else if (request.system) {
    systemPrompt = request.system;
  }

  // Inject context into system prompt (only for new sessions)
  if (contextString && !request.session_id) {
    systemPrompt = `${systemPrompt}\n\n--- DIRECTORY CONTEXT ---\n${contextString}\n--- END DIRECTORY CONTEXT ---`;
  }

  // Build the prompt based on whether we're resuming a session
  const hasSession = Boolean(request.session_id);
  const prompt = buildPromptWithHistory(request.messages, hasSession);

  // Execute Claude CLI with all options
  const result = await executeClaudeQuery({
    query: prompt,
    systemPrompt: hasSession ? undefined : systemPrompt, // Don't override system prompt when resuming
    configDir: config.claudeConfigDir,
    workingDirectory: workingDir,
    timeout: 120_000,

    // === MODEL SELECTION ===
    model: request.model,
    fallbackModel: request.fallback_model,

    // === SESSION CONTROL ===
    sessionId: request.session_id,
    continueConversation: request.continue_conversation,
    forkSession: request.fork_session,
    ephemeral: request.ephemeral,

    // === TOOL CONTROL ===
    tools: request.tools,
    allowedTools: request.allowed_tools,
    disallowedTools: request.disallowed_tools,

    // === BUDGET & PERMISSIONS ===
    maxBudgetUsd: request.max_budget_usd,
    permissionMode: request.permission_mode,

    // === SYSTEM PROMPT ===
    appendSystemPrompt: hasSession ? undefined : request.append_system_prompt,

    // === STRUCTURED OUTPUT ===
    jsonSchema: request.json_schema,

    // === AGENT CONTROL ===
    agent: request.agent,
    agents: request.agents,

    // === DIRECTORY ACCESS ===
    addDirs: request.add_dirs,

    // === MCP INTEGRATION ===
    mcpConfig: request.mcp_config,
    strictMcpConfig: request.strict_mcp_config,

    // === ADVANCED ===
    verbose: request.verbose,
    betas: request.betas,
  });

  if (!result.success) {
    return {
      error: {
        message: result.error || 'Claude CLI execution failed',
        type: 'server_error',
        code: 'claude_cli_error',
        details: {
          sessionId: result.sessionId,
        },
      },
    };
  }

  // Build response with actual token counts from Claude
  const completionId = generateCompletionId();

  // Determine the model name from metadata or request
  const modelName = result.metadata?.modelUsage
    ? Object.keys(result.metadata.modelUsage).find((m) => !m.includes('haiku')) || 'claude-code-cli'
    : request.model || 'claude-code-cli';

  const response: ChatCompletionResponse = {
    id: completionId,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: result.output,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: result.metadata?.usage.inputTokens ?? 0,
      completion_tokens: result.metadata?.usage.outputTokens ?? 0,
      total_tokens:
        (result.metadata?.usage.inputTokens ?? 0) + (result.metadata?.usage.outputTokens ?? 0),
      cache_read_tokens: result.metadata?.usage.cacheReadTokens,
      cache_creation_tokens: result.metadata?.usage.cacheCreationTokens,
    },
    // Include session_id for conversation continuity
    session_id: result.sessionId || undefined,
    // Include rich metadata
    claude_metadata: result.metadata || undefined,
  };

  return response;
}

/**
 * Handle streaming chat completion request
 * Returns an async generator for SSE streaming
 *
 * NOTE: Claude CLI doesn't support true streaming in headless mode.
 * We simulate streaming by chunking the complete response.
 */
export async function* handleStreamingChatCompletion(
  request: ChatCompletionRequest,
  config: ServerConfig
): AsyncGenerator<ChatCompletionChunk | APIError, void, unknown> {
  // Execute the full request first
  const result = await handleChatCompletion(request, config);

  if ('error' in result) {
    yield result;
    return;
  }

  const completionId = result.id;
  const content = result.choices[0]?.message.content || '';
  const sessionId = result.session_id;

  // Simulate streaming by yielding chunks
  const chunkSize = 20; // characters per chunk
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    yield {
      id: completionId,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: 'claude-code-cli',
      choices: [
        {
          index: 0,
          delta: { content: chunk },
          finish_reason: null,
        },
      ],
    };
  }

  // Final chunk with finish_reason and session_id
  yield {
    id: completionId,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: 'claude-code-cli',
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop',
      },
    ],
    session_id: sessionId, // Include session_id in final chunk
  };
}

/**
 * Check if response is an error
 */
export function isErrorResponse(
  response: ChatCompletionResponse | APIError
): response is APIError {
  return 'error' in response;
}
