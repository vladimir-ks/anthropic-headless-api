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

// Security limits for JSON parameters passed to CLI
const MAX_JSON_SIZE = 10_240; // 10KB
const MAX_JSON_DEPTH = 10;

/**
 * Validate JSON object before passing to CLI to prevent injection attacks
 * @throws Error if JSON is malicious or exceeds safety limits
 */
function validateJSONForCLI(obj: unknown, paramName: string): string {
  // Check depth to prevent deeply nested attack payloads
  function getDepth(o: unknown, currentDepth = 0): number {
    if (currentDepth > MAX_JSON_DEPTH) {
      throw new Error(`${paramName} exceeds maximum depth of ${MAX_JSON_DEPTH}`);
    }
    if (typeof o !== 'object' || o === null) return currentDepth;

    const depths = Object.values(o).map(v => getDepth(v, currentDepth + 1));
    return Math.max(currentDepth, ...depths);
  }

  getDepth(obj);

  // Stringify and check size
  const json = JSON.stringify(obj);
  if (json.length > MAX_JSON_SIZE) {
    throw new Error(`${paramName} exceeds maximum size of ${MAX_JSON_SIZE} bytes (got ${json.length})`);
  }

  // Defense-in-depth validation (Note: Bun.spawn with array args prevents shell injection,
  // but we validate to prevent future vulnerabilities if code changes to use shell=true)

  // 1. Check for null bytes (can truncate strings or cause parsing issues)
  if (json.includes('\0')) {
    throw new Error(`${paramName} contains null bytes`);
  }

  // 2. Check for control characters that shouldn't be in JSON strings
  const controlChars = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
  if (controlChars.test(json)) {
    throw new Error(`${paramName} contains invalid control characters`);
  }

  // 3. Check JSON nesting depth to prevent deeply nested attacks
  const maxDepth = 20;
  let depth = 0;
  let maxSeenDepth = 0;
  for (const char of json) {
    if (char === '{' || char === '[') {
      depth++;
      maxSeenDepth = Math.max(maxSeenDepth, depth);
      if (depth > maxDepth) {
        throw new Error(`${paramName} exceeds maximum nesting depth of ${maxDepth}`);
      }
    } else if (char === '}' || char === ']') {
      depth--;
    }
  }

  // 4. Check for suspicious shell metacharacters (defense-in-depth)
  const suspiciousPatterns = [
    /\$\(/,      // Command substitution
    /`/,         // Backticks
    /&&/,        // Command chaining
    /\|\|/,      // Command chaining
    /;\s*\w/,    // Command separator followed by command
    />\s*&/,     // Redirection
    /\|\s*\w/,   // Pipe to command
    /<\s*\(/,    // Process substitution
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(json)) {
      throw new Error(`${paramName} contains suspicious pattern: shell metacharacters`);
    }
  }

  return json;
}

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
    const validated = validateJSONForCLI(options.jsonSchema, 'jsonSchema');
    args.push('--json-schema', validated);
  }

  // === AGENT CONTROL ===
  if (options.agent) {
    args.push('--agent', options.agent);
  }
  if (options.agents) {
    const validated = validateJSONForCLI(options.agents, 'agents');
    args.push('--agents', validated);
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

  // Validate query is not empty
  if (!options.query || options.query.trim().length === 0) {
    throw new Error('Claude CLI query cannot be empty or whitespace-only');
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
  let proc: ReturnType<typeof Bun.spawn> | null = null;

  try {
    proc = Bun.spawn([CLAUDE_BINARY, ...args], {
      env,
      cwd,
      stdin: useStdin ? 'pipe' : undefined,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    // Write query to stdin if needed (using Bun's FileSink API)
    if (useStdin && proc.stdin && typeof proc.stdin !== 'number') {
      try {
        proc.stdin.write(options.query);
        proc.stdin.end();
      } catch (stdinError) {
        // If stdin write fails, kill process and cleanup
        proc.kill();
        throw new Error(`Failed to write to stdin: ${stdinError instanceof Error ? stdinError.message : String(stdinError)}`);
      }
    }

    // Set up timeout with proper cleanup
    const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (proc) {
          proc.kill();
        }
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

    // Read output (streams auto-close when process exits)
    const stdout = proc.stdout && typeof proc.stdout !== 'number'
      ? await new Response(proc.stdout).text()
      : '';
    const stderr = proc.stderr && typeof proc.stderr !== 'number'
      ? await new Response(proc.stderr).text()
      : '';

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

      // Validate required fields exist
      if (typeof jsonOutput !== 'object' || jsonOutput === null) {
        throw new Error('Invalid JSON structure');
      }

      if (jsonOutput.is_error || jsonOutput.subtype === 'error') {
        return {
          success: false,
          output: '',
          sessionId: jsonOutput.session_id || null,
          metadata: null,
          error: jsonOutput.result || 'Claude returned an error',
        };
      }

      // Validate usage object exists before accessing
      const usage = jsonOutput.usage || {};

      // Extract metadata with safe defaults
      const metadata: ClaudeMetadata = {
        durationMs: jsonOutput.duration_ms ?? 0,
        durationApiMs: jsonOutput.duration_api_ms ?? 0,
        numTurns: jsonOutput.num_turns ?? 1,
        totalCostUsd: jsonOutput.total_cost_usd ?? 0,
        usage: {
          inputTokens: usage.input_tokens ?? 0,
          outputTokens: usage.output_tokens ?? 0,
          cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
          cacheReadTokens: usage.cache_read_input_tokens ?? 0,
        },
        modelUsage: jsonOutput.modelUsage ?? {},
        uuid: jsonOutput.uuid ?? '',
      };

      return {
        success: true,
        output: jsonOutput.result ?? '',
        sessionId: jsonOutput.session_id ?? null,
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
      timeoutId = null;
    }

    // Ensure process is killed on error
    if (proc) {
      try {
        proc.kill();
      } catch {
        // Ignore kill errors (process may already be dead)
      }
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
 * Logs errors to help debug startup issues
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
  } catch (error) {
    console.error('Failed to get Claude CLI version:', error instanceof Error ? error.message : error);
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
    if (!lastUserMessage) {
      throw new Error('Cannot resume session: no user messages found in conversation');
    }
    return lastUserMessage.content;
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
