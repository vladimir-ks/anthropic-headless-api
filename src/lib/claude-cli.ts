/**
 * Claude Code CLI wrapper
 *
 * Executes Claude Code CLI in headless mode (-p) with JSON output
 * and returns structured results including session_id for conversation continuity.
 *
 * IMPORTANT: Uses --output-format json to get rich metadata including:
 * - session_id (for conversation continuity)
 * - total_cost_usd (for quota tracking)
 * - usage tokens (for monitoring)
 * - duration_ms (for performance tracking)
 */

import type {
  ClaudeExecuteOptions,
  ClaudeExecuteResult,
  ClaudeCliJsonOutput,
  ClaudeMetadata,
} from '../types/claude';

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const CLAUDE_BINARY = 'claude';

/**
 * Execute a query using Claude Code CLI in headless mode with JSON output
 */
export async function executeClaudeQuery(
  options: ClaudeExecuteOptions
): Promise<ClaudeExecuteResult> {
  const args: string[] = ['-p', '--output-format', 'json'];

  // === MODEL SELECTION ===
  if (options.model) {
    args.push('--model', options.model);
  }
  if (options.fallbackModel) {
    args.push('--fallback-model', options.fallbackModel);
  }

  // === SYSTEM PROMPT ===
  if (options.systemPrompt) {
    args.push('--system-prompt', options.systemPrompt);
  }
  if (options.appendSystemPrompt) {
    args.push('--append-system-prompt', options.appendSystemPrompt);
  }

  // === SESSION CONTROL ===
  if (options.continueConversation) {
    args.push('--continue');
  } else if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }
  if (options.forkSession) {
    args.push('--fork-session');
  }
  if (options.ephemeral) {
    args.push('--no-session-persistence');
  }

  // === TOOL CONTROL ===
  if (options.tools !== undefined) {
    if (options.tools === '') {
      args.push('--tools', '');
    } else if (options.tools === 'default') {
      args.push('--tools', 'default');
    } else if (Array.isArray(options.tools) && options.tools.length > 0) {
      args.push('--tools', options.tools.join(','));
    }
  }
  if (options.allowedTools && options.allowedTools.length > 0) {
    args.push('--allowedTools', options.allowedTools.join(','));
  }
  if (options.disallowedTools && options.disallowedTools.length > 0) {
    args.push('--disallowedTools', options.disallowedTools.join(','));
  }

  // === BUDGET & PERMISSIONS ===
  if (options.maxBudgetUsd !== undefined && options.maxBudgetUsd > 0) {
    args.push('--max-budget-usd', String(options.maxBudgetUsd));
  }
  if (options.permissionMode && options.permissionMode !== 'default') {
    args.push('--permission-mode', options.permissionMode);
  }

  // === STRUCTURED OUTPUT ===
  if (options.jsonSchema) {
    args.push('--json-schema', JSON.stringify(options.jsonSchema));
  }

  // === AGENT CONTROL ===
  if (options.agent) {
    args.push('--agent', options.agent);
  }
  if (options.agents) {
    args.push('--agents', JSON.stringify(options.agents));
  }

  // === DIRECTORY ACCESS ===
  if (options.addDirs && options.addDirs.length > 0) {
    args.push('--add-dir', ...options.addDirs);
  }

  // === MCP INTEGRATION ===
  if (options.mcpConfig && options.mcpConfig.length > 0) {
    args.push('--mcp-config', ...options.mcpConfig);
  }
  if (options.strictMcpConfig) {
    args.push('--strict-mcp-config');
  }

  // === ADVANCED ===
  if (options.verbose) {
    args.push('--verbose');
  }
  if (options.betas && options.betas.length > 0) {
    args.push('--betas', ...options.betas);
  }

  // Determine if we need to use stdin for the query
  // Variadic flags like --allowedTools consume positional args, so we must use stdin
  const useStdin =
    (options.allowedTools && options.allowedTools.length > 0) ||
    (options.disallowedTools && options.disallowedTools.length > 0) ||
    (options.addDirs && options.addDirs.length > 0) ||
    (options.mcpConfig && options.mcpConfig.length > 0) ||
    (options.betas && options.betas.length > 0);

  // Add the query as positional arg only if not using stdin
  if (!useStdin) {
    args.push(options.query);
  }

  // Build environment (filter undefined values for type safety)
  const env: Record<string, string> = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
  if (options.configDir) {
    env.CLAUDE_CONFIG_DIR = options.configDir;
  }

  // Set working directory
  const cwd = options.workingDirectory || process.cwd();

  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    const proc = Bun.spawn([CLAUDE_BINARY, ...args], {
      env,
      cwd,
      stdin: useStdin ? 'pipe' : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Write query to stdin if needed (using Bun's FileSink API)
    if (useStdin && proc.stdin) {
      proc.stdin.write(options.query);
      proc.stdin.end();
    }

    // Set up timeout with proper cleanup
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        proc.kill();
        reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    // Wait for completion or timeout
    const exitCode = await Promise.race([proc.exited, timeoutPromise]);

    // Clear timeout on success (prevent memory leak)
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    // Read output
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();

    if (exitCode !== 0) {
      return {
        success: false,
        output: '',
        sessionId: null,
        metadata: null,
        error: stderr || `Claude CLI exited with code ${exitCode}`,
      };
    }

    // Parse JSON output
    try {
      const jsonOutput = JSON.parse(stdout.trim()) as ClaudeCliJsonOutput;

      if (jsonOutput.is_error || jsonOutput.subtype === 'error') {
        return {
          success: false,
          output: '',
          sessionId: jsonOutput.session_id || null,
          metadata: null,
          error: jsonOutput.result || 'Claude returned an error',
        };
      }

      // Extract metadata
      const metadata: ClaudeMetadata = {
        durationMs: jsonOutput.duration_ms,
        durationApiMs: jsonOutput.duration_api_ms,
        numTurns: jsonOutput.num_turns,
        totalCostUsd: jsonOutput.total_cost_usd,
        usage: {
          inputTokens: jsonOutput.usage.input_tokens,
          outputTokens: jsonOutput.usage.output_tokens,
          cacheCreationTokens: jsonOutput.usage.cache_creation_input_tokens,
          cacheReadTokens: jsonOutput.usage.cache_read_input_tokens,
        },
        modelUsage: jsonOutput.modelUsage,
        uuid: jsonOutput.uuid,
      };

      return {
        success: true,
        output: jsonOutput.result,
        sessionId: jsonOutput.session_id,
        metadata,
      };
    } catch (parseError) {
      // If JSON parsing fails, treat as text output (fallback)
      return {
        success: true,
        output: stdout.trim(),
        sessionId: null,
        metadata: null,
      };
    }
  } catch (error) {
    // Clear timeout on error
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      output: '',
      sessionId: null,
      metadata: null,
      error: message,
    };
  }
}

/**
 * Check if Claude Code CLI is available
 */
export async function checkClaudeAvailable(): Promise<boolean> {
  try {
    const proc = Bun.spawn([CLAUDE_BINARY, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    return exitCode === 0;
  } catch {
    return false;
  }
}

/**
 * Get Claude CLI version
 */
export async function getClaudeVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn([CLAUDE_BINARY, '--version'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Build a combined prompt with conversation history
 *
 * NOTE: This is used when NOT resuming a session.
 * When resuming (sessionId provided), just send the latest message
 * as Claude already has the conversation context.
 */
export function buildPromptWithHistory(
  messages: Array<{ role: string; content: string }>,
  hasSessionId: boolean
): string {
  // If resuming a session, only send the latest user message
  // Claude already has the conversation history internally
  if (hasSessionId) {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    return lastUserMessage?.content || '';
  }

  // For new sessions, build full context
  const parts: string[] = [];

  // Add conversation history (excluding system messages)
  const conversationMessages = messages.filter((m) => m.role !== 'system');

  if (conversationMessages.length > 1) {
    parts.push('--- CONVERSATION HISTORY ---');
    for (const msg of conversationMessages.slice(0, -1)) {
      const roleLabel = msg.role === 'user' ? 'User' : 'Assistant';
      parts.push(`${roleLabel}: ${msg.content}`);
    }
    parts.push('--- END HISTORY ---');
    parts.push('');
  }

  // Add current query (last user message)
  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (lastMessage) {
    if (conversationMessages.length > 1) {
      parts.push('Current query:');
    }
    parts.push(lastMessage.content);
  }

  return parts.join('\n');
}
