#!/usr/bin/env bun
/**
 * claude-api1 - Interactive CLI client for anthropic-headless-api
 *
 * Features:
 * - Interactive chat with streaming responses
 * - Session continuity (remembers conversation)
 * - CONTEXT.md reading from current directory
 * - /see-json command to view last response
 * - /new to start fresh conversation
 * - /quit or /exit to quit
 *
 * Usage:
 *   claude-api1                    # Connect to localhost:3456
 *   claude-api1 --port 8080        # Custom port
 *   claude-api1 --model opus       # Use specific model
 */

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

interface Config {
  baseUrl: string;
  model?: string;
  workingDirectory: string;
}

function parseArgs(): Config {
  const args = process.argv.slice(2);
  let port = 3456;
  let host = 'localhost';
  let model: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      const parsedPort = parseInt(args[i + 1], 10);
      if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
        console.error(`Invalid port: ${args[i + 1]}. Must be between 1-65535.`);
        process.exit(1);
      }
      port = parsedPort;
      i++;
    } else if (args[i] === '--host' && args[i + 1]) {
      const hostValue = args[i + 1].trim();
      if (!hostValue || hostValue.length === 0) {
        console.error('Invalid host: cannot be empty');
        process.exit(1);
      }
      host = hostValue;
      i++;
    } else if (args[i] === '--model' && args[i + 1]) {
      model = args[i + 1];
      i++;
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
claude-api1 - Interactive CLI for anthropic-headless-api

Usage:
  claude-api1 [options]

Options:
  --port <port>     Server port (default: 3456)
  --host <host>     Server host (default: localhost)
  --model <model>   Model: opus, sonnet, haiku (default: server default)
  --help, -h        Show this help

Commands (in chat):
  /see-json         Show full JSON from last response
  /new              Start new conversation (clear session)
  /model <name>     Switch model
  /quit, /exit      Exit the client
`);
      process.exit(0);
    }
  }

  return {
    baseUrl: `http://${host}:${port}`,
    model,
    workingDirectory: process.cwd(),
  };
}

// =============================================================================
// STATE
// =============================================================================

interface ClientState {
  sessionId: string | null;
  lastResponse: unknown | null;
  config: Config;
  contextMd: string | null;
}

// =============================================================================
// CONTEXT.MD READING
// =============================================================================

function readContextMd(workingDir: string): string | null {
  const contextPath = path.join(workingDir, 'CONTEXT.md');
  try {
    if (fs.existsSync(contextPath)) {
      return fs.readFileSync(contextPath, 'utf-8');
    }
  } catch {
    // Ignore errors
  }
  return null;
}

// =============================================================================
// API CLIENT
// =============================================================================

async function sendMessage(
  state: ClientState,
  message: string
): Promise<{ content: string; sessionId: string | null; fullResponse: unknown }> {
  const body: Record<string, unknown> = {
    messages: [{ role: 'user', content: message }],
    stream: true,
  };

  // Include session_id for continuation
  if (state.sessionId) {
    body.session_id = state.sessionId;
  }

  // Include working directory (for CONTEXT.md on first message)
  if (!state.sessionId) {
    body.working_directory = state.config.workingDirectory;
  }

  // Include model if specified
  if (state.config.model) {
    body.model = state.config.model;
  }

  const response = await fetch(`${state.config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || `HTTP ${response.status}`);
  }

  // Handle streaming response
  if (response.headers.get('content-type')?.includes('text/event-stream')) {
    return handleStreamingResponse(response);
  }

  // Non-streaming fallback
  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    sessionId: data.session_id || null,
    fullResponse: data,
  };
}

async function handleStreamingResponse(response: Response): Promise<{
  content: string;
  sessionId: string | null;
  fullResponse: unknown;
}> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let content = '';
  let sessionId: string | null = null;
  let lastChunk: unknown = null;

  // Collect all chunks for full response
  const allChunks: unknown[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value, { stream: true });
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;

          try {
            const chunk = JSON.parse(data);
            allChunks.push(chunk);
            lastChunk = chunk;

            // Extract content delta
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              process.stdout.write(delta);
              content += delta;
            }

            // Extract session_id from final chunk
            if (chunk.session_id) {
              sessionId = chunk.session_id;
            }
          } catch {
            // Ignore individual chunk parse errors (partial data)
          }
        }
      }
    }
  } finally {
    // Release the reader lock to free resources
    reader.releaseLock();
  }

  // Print newline after streaming
  console.log();

  return {
    content,
    sessionId,
    fullResponse: {
      chunks: allChunks,
      lastChunk,
      sessionId,
      content,
    },
  };
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

function handleCommand(
  state: ClientState,
  input: string,
  rl?: readline.Interface
): boolean {
  const [cmd, ...args] = input.slice(1).split(' ');

  switch (cmd.toLowerCase()) {
    case 'see-json':
      if (state.lastResponse) {
        console.log('\n--- LAST RESPONSE JSON ---');
        console.log(JSON.stringify(state.lastResponse, null, 2));
        console.log('--- END JSON ---\n');
      } else {
        console.log('No response yet.');
      }
      return true;

    case 'new':
      state.sessionId = null;
      state.lastResponse = null;
      console.log('Session cleared. Starting fresh conversation.');
      return true;

    case 'model':
      if (args[0]) {
        state.config.model = args[0];
        console.log(`Model set to: ${args[0]}`);
      } else {
        console.log(`Current model: ${state.config.model || 'default'}`);
      }
      return true;

    case 'session':
      console.log(`Session ID: ${state.sessionId || 'none (new conversation)'}`);
      return true;

    case 'quit':
    case 'exit':
      console.log('Goodbye!');
      if (rl) {
        rl.close();
      }
      process.exit(0);

    case 'help':
      console.log(`
Commands:
  /see-json     Show full JSON from last response
  /new          Start new conversation
  /model [name] Show or set model (opus, sonnet, haiku)
  /session      Show current session ID
  /quit, /exit  Exit
`);
      return true;

    default:
      console.log(`Unknown command: /${cmd}. Type /help for commands.`);
      return true;
  }
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const config = parseArgs();

  // Check server health
  try {
    const health = await fetch(`${config.baseUrl}/health`);
    if (!health.ok) throw new Error('Server not healthy');
    const data = await health.json();
    console.log(`Connected to anthropic-headless-api v${data.version}`);
    console.log(`Backend: ${data.backend} (${data.claude_version || 'unknown'})`);
  } catch (error) {
    console.error(`Cannot connect to server at ${config.baseUrl}`);
    console.error('Make sure the server is running: bun run start');
    process.exit(1);
  }

  // Read CONTEXT.md
  const contextMd = readContextMd(config.workingDirectory);
  if (contextMd) {
    console.log(`Found CONTEXT.md (${contextMd.length} bytes) - will include in first message`);
  }

  // Initialize state
  const state: ClientState = {
    sessionId: null,
    lastResponse: null,
    config,
    contextMd,
  };

  console.log(`\nModel: ${config.model || 'default'}`);
  console.log('Type /help for commands, /quit to exit\n');

  // Create readline interface
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Request queue to prevent concurrent message sends
  let isProcessing = false;

  const prompt = () => {
    rl.question('You: ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt();
        return;
      }

      // Handle commands
      if (trimmed.startsWith('/')) {
        handleCommand(state, trimmed, rl);
        prompt();
        return;
      }

      // Wait if another request is in progress
      if (isProcessing) {
        console.log('Please wait for the current request to complete...');
        prompt();
        return;
      }

      // Send message
      isProcessing = true;
      try {
        process.stdout.write('Claude: ');
        const result = await sendMessage(state, trimmed);

        // Update state (safe now that we have sequential processing)
        state.sessionId = result.sessionId;
        state.lastResponse = result.fullResponse;

        console.log(); // Extra newline for spacing
      } catch (error) {
        console.error(`\nError: ${error instanceof Error ? error.message : error}`);
      } finally {
        isProcessing = false;
      }

      prompt();
    });
  };

  // Handle Ctrl+C gracefully
  rl.on('close', () => {
    console.log('\nGoodbye!');
    process.exit(0);
  });

  prompt();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
