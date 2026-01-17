/**
 * anthropic-headless-api
 *
 * OpenAI-compatible API server wrapping Claude Code CLI
 *
 * Process name: anthropic-headless-api
 *
 * Usage:
 *   bun run src/index.ts
 *   bun run src/index.ts --port 3456
 *   CLAUDE_CONFIG_DIR=~/.claude-inst7 bun run src/index.ts
 *
 * Environment Variables:
 *   PORT              - Server port (default: 3456)
 *   HOST              - Server host (default: 127.0.0.1)
 *   CLAUDE_CONFIG_DIR - Claude configuration directory
 *   DEFAULT_SYSTEM_PROMPT - Default system prompt
 *   CONTEXT_FILENAME  - Context file name (default: CONTEXT.md)
 *   ENABLE_CORS       - Enable CORS (default: true)
 *   LOG_LEVEL         - Log level: debug, info, warn, error (default: info)
 *   RATE_LIMIT_MAX    - Max requests per minute (default: 60)
 *   RATE_LIMIT_ENABLED - Enable rate limiting (default: true)
 */

import type { ServerConfig, ChatCompletionRequest, APIError } from './types/api';
import {
  handleChatCompletion,
  handleStreamingChatCompletion,
  isErrorResponse,
} from './routes/chat';
import { checkClaudeAvailable, getClaudeVersion } from './lib/claude-cli';
import {
  RateLimiter,
  getRateLimitKey,
  type RateLimitResult,
} from './middleware/rate-limiter';

// Set process title for identification in activity monitors
process.title = 'anthropic-headless-api';

// =============================================================================
// CONFIGURATION
// =============================================================================

function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT || '3456', 10),
    host: process.env.HOST || '127.0.0.1',
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    defaultSystemPrompt: process.env.DEFAULT_SYSTEM_PROMPT || '',
    contextFileName: process.env.CONTEXT_FILENAME || 'CONTEXT.md',
    enableCors: process.env.ENABLE_CORS !== 'false',
    logLevel: (process.env.LOG_LEVEL as ServerConfig['logLevel']) || 'info',
    rateLimit: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
      windowMs: 60_000, // 1 minute
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    },
  };
}

// =============================================================================
// LOGGING
// =============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(config: ServerConfig) {
  const level = LOG_LEVELS[config.logLevel] ?? 1;
  const prefix = '[anthropic-headless-api]';

  return {
    debug: (...args: unknown[]) =>
      level <= 0 && console.log(`${prefix} [DEBUG]`, new Date().toISOString(), ...args),
    info: (...args: unknown[]) =>
      level <= 1 && console.log(`${prefix} [INFO]`, new Date().toISOString(), ...args),
    warn: (...args: unknown[]) =>
      level <= 2 && console.warn(`${prefix} [WARN]`, new Date().toISOString(), ...args),
    error: (...args: unknown[]) =>
      level <= 3 && console.error(`${prefix} [ERROR]`, new Date().toISOString(), ...args),
  };
}

// =============================================================================
// RESPONSE HELPERS
// =============================================================================

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key, X-Session-Id',
  };
}

function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': '60',
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(Math.floor(result.resetAt / 1000)),
    ...(result.retryAfter ? { 'Retry-After': String(result.retryAfter) } : {}),
  };
}

function jsonResponse(
  data: unknown,
  status: number = 200,
  extraHeaders: Record<string, string> = {}
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
    ...extraHeaders,
  };

  return new Response(JSON.stringify(data), { status, headers });
}

function sseResponse(
  stream: ReadableStream,
  extraHeaders: Record<string, string> = {}
): Response {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    ...corsHeaders(),
    ...extraHeaders,
  };

  return new Response(stream, { headers });
}

// =============================================================================
// REQUEST HANDLER
// =============================================================================

async function handleRequest(
  req: Request,
  config: ServerConfig,
  log: ReturnType<typeof createLogger>,
  rateLimiter: RateLimiter,
  serverInfo: { version: string; claudeVersion: string | null; startTime: Date }
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  log.debug(`${method} ${path}`);

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check (bypass rate limit)
  if (path === '/health' || path === '/') {
    return jsonResponse({
      status: 'ok',
      version: serverInfo.version,
      backend: 'claude-code-cli',
      claude_version: serverInfo.claudeVersion,
      uptime_seconds: Math.floor((Date.now() - serverInfo.startTime.getTime()) / 1000),
    });
  }

  // Rate limit check for all other endpoints
  const rateLimitKey = getRateLimitKey(req);
  const rateLimitResult = rateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    log.warn(`Rate limited: ${rateLimitKey}`);
    const error: APIError = {
      error: {
        message: 'Too many requests. Please slow down.',
        type: 'rate_limit_error',
        code: 'rate_limited',
        details: {
          retry_after: rateLimitResult.retryAfter,
        },
      },
    };
    return jsonResponse(error, 429, rateLimitHeaders(rateLimitResult));
  }

  // List models
  if (path === '/v1/models' && method === 'GET') {
    return jsonResponse(
      {
        object: 'list',
        data: [
          {
            id: 'claude-code-cli',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'anthropic',
          },
        ],
      },
      200,
      rateLimitHeaders(rateLimitResult)
    );
  }

  // Chat completions
  if (path === '/v1/chat/completions' && method === 'POST') {
    // Check request size limit (1MB default)
    const MAX_REQUEST_SIZE = 1024 * 1024;
    const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
    if (contentLength > MAX_REQUEST_SIZE) {
      return jsonResponse(
        {
          error: {
            message: `Request body too large. Maximum size is ${MAX_REQUEST_SIZE} bytes`,
            type: 'invalid_request_error',
            code: 'request_too_large',
          },
        },
        413,
        rateLimitHeaders(rateLimitResult)
      );
    }

    try {
      const body = (await req.json()) as ChatCompletionRequest;

      // Check for session_id in header (alternative to body)
      const headerSessionId = req.headers.get('X-Session-Id');
      if (headerSessionId && !body.session_id) {
        // Validate UUID format
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        if (!uuidRegex.test(headerSessionId)) {
          return jsonResponse(
            {
              error: {
                message: 'X-Session-Id header must be a valid UUID',
                type: 'invalid_request_error',
                code: 'invalid_session_id',
              },
            },
            400,
            rateLimitHeaders(rateLimitResult)
          );
        }
        body.session_id = headerSessionId;
      }

      log.info(
        `Chat request: msgs=${body.messages?.length || 0}, model=${body.model || 'default'}, stream=${body.stream || false}, session=${body.session_id ? body.session_id.slice(0, 8) + '...' : 'new'}`
      );

      // Handle streaming
      if (body.stream) {
        const stream = new ReadableStream({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              for await (const chunk of handleStreamingChatCompletion(body, config)) {
                // Check if this is an error response
                if ('error' in chunk) {
                  const errorData = `data: ${JSON.stringify(chunk)}\n\n`;
                  controller.enqueue(encoder.encode(errorData));
                  break;
                }
                const data = `data: ${JSON.stringify(chunk)}\n\n`;
                controller.enqueue(encoder.encode(data));
              }
              controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            } catch (streamError) {
              log.error('Stream error:', streamError);
              const errorChunk = {
                error: {
                  message: streamError instanceof Error ? streamError.message : 'Stream error',
                  type: 'server_error',
                  code: 'stream_error',
                },
              };
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(errorChunk)}\n\n`));
            } finally {
              controller.close();
            }
          },
        });

        return sseResponse(stream, rateLimitHeaders(rateLimitResult));
      }

      // Non-streaming
      const result = await handleChatCompletion(body, config);

      if (isErrorResponse(result)) {
        const status = result.error.type === 'invalid_request_error' ? 400 : 500;
        return jsonResponse(result, status, rateLimitHeaders(rateLimitResult));
      }

      const meta = result.claude_metadata;
      log.info(
        `Completed: session=${result.session_id?.slice(0, 8) || 'none'}..., tokens=${meta?.usage.inputTokens || 0}→${meta?.usage.outputTokens || 0}, cache=${meta?.usage.cacheReadTokens || 0}r/${meta?.usage.cacheCreationTokens || 0}w, cost=$${meta?.totalCostUsd?.toFixed(4) || 'N/A'}, time=${meta?.durationMs || 'N/A'}ms`
      );

      return jsonResponse(result, 200, rateLimitHeaders(rateLimitResult));
    } catch (error) {
      log.error('Request error:', error);

      // Distinguish between JSON parse errors and other errors
      if (error instanceof SyntaxError) {
        return jsonResponse(
          {
            error: {
              message: 'Invalid JSON in request body',
              type: 'invalid_request_error',
              code: 'json_parse_error',
            },
          },
          400,
          rateLimitHeaders(rateLimitResult)
        );
      }

      // Sanitize error message to avoid leaking implementation details
      const safeMessage =
        error instanceof Error && !error.stack?.includes('node_modules')
          ? error.message
          : 'Internal server error';

      const apiError: APIError = {
        error: {
          message: safeMessage,
          type: 'server_error',
          code: 'internal_error',
        },
      };
      return jsonResponse(apiError, 500, rateLimitHeaders(rateLimitResult));
    }
  }

  // 404 for unknown routes
  return jsonResponse(
    {
      error: {
        message: `Unknown route: ${method} ${path}`,
        type: 'invalid_request_error',
        code: 'unknown_route',
      },
    },
    404,
    rateLimitHeaders(rateLimitResult)
  );
}

// =============================================================================
// SERVER
// =============================================================================

async function main() {
  const config = loadConfig();
  const log = createLogger(config);
  const startTime = new Date();

  log.info('Starting anthropic-headless-api...');

  // Check Claude CLI availability
  log.info('Checking Claude Code CLI...');
  const claudeAvailable = await checkClaudeAvailable();
  if (!claudeAvailable) {
    log.error('Claude Code CLI not found or not authenticated.');
    log.error('Please ensure claude is installed and you are logged in.');
    process.exit(1);
  }

  const claudeVersion = await getClaudeVersion();
  log.info(`Claude Code CLI: ${claudeVersion || 'available'}`);

  // Initialize rate limiter
  const rateLimiter = new RateLimiter(
    config.rateLimit || { maxRequests: 60, windowMs: 60_000, enabled: true }
  );
  log.info(
    `Rate limiting: ${config.rateLimit?.enabled !== false ? 'enabled' : 'disabled'} (${config.rateLimit?.maxRequests || 60}/min)`
  );

  // Server info for health endpoint
  const serverInfo = {
    version: '0.2.0',
    claudeVersion,
    startTime,
  };

  // Start server
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: (req) => handleRequest(req, config, log, rateLimiter, serverInfo),
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.stop();

    // Stop rate limiter cleanup interval
    rateLimiter.stop();

    log.info('Server stopped.');
    process.exit(0);
  };

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Log startup complete
  log.info('='.repeat(60));
  log.info(`anthropic-headless-api v${serverInfo.version} started`);
  log.info(`Listening on http://${config.host}:${config.port}`);
  log.info(`Context file: ${config.contextFileName}`);
  if (config.claudeConfigDir) {
    log.info(`Claude config: ${config.claudeConfigDir}`);
  }
  log.info('='.repeat(60));
  log.info('');
  log.info('Endpoints:');
  log.info('  POST /v1/chat/completions  - Chat completions (OpenAI-compatible)');
  log.info('  GET  /v1/models            - List models');
  log.info('  GET  /health               - Health check');
  log.info('');
  log.info('Session continuity:');
  log.info('  - Response includes session_id');
  log.info('  - Pass session_id in next request to continue conversation');
  log.info('  - Or use X-Session-Id header');
  log.info('');
}

main().catch((err) => {
  console.error('[anthropic-headless-api] Fatal error:', err);
  process.exit(1);
});
