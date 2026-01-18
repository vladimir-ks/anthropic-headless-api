/**
 * anthropic-headless-api - Intelligent AI Gateway
 *
 * Multi-backend routing system with intelligent request distribution:
 * - Claude CLI for tool-use requests (Read, Write, Bash)
 * - Direct API pass-through for simple chat (OpenRouter, OpenAI, Gemini)
 * - Process pool management to prevent resource exhaustion
 * - Universal logging to SQLite + Langfuse
 * - Fallback logic for graceful degradation
 *
 * Process name: anthropic-headless-api
 */

import type { ServerConfig, ChatCompletionRequest, APIError } from './types/api';
import { BackendRegistry } from './lib/backend-registry';
import { ProcessPoolRegistry } from './lib/process-pool';
import { IntelligentRouter } from './lib/router';
import { SQLiteLogger } from './lib/sqlite-logger';
import {
  RateLimiter,
  getRateLimitKey,
  type RateLimitResult,
} from './middleware/rate-limiter';
import {
  validateChatCompletionRequest,
  formatValidationErrors,
} from './validation/schemas';

// Set process title for identification in activity monitors
process.title = 'anthropic-headless-api';

// =============================================================================
// CONFIGURATION
// =============================================================================

function loadConfig(): ServerConfig {
  // Validate log level with type guard
  const validLogLevels = ['debug', 'info', 'warn', 'error'] as const;
  const envLogLevel = process.env.LOG_LEVEL;
  const logLevel: ServerConfig['logLevel'] =
    envLogLevel && validLogLevels.includes(envLogLevel as typeof validLogLevels[number])
      ? (envLogLevel as ServerConfig['logLevel'])
      : 'info';

  return {
    port: parseInt(process.env.PORT || '3456', 10),
    host: process.env.HOST || '127.0.0.1',
    claudeConfigDir: process.env.CLAUDE_CONFIG_DIR,
    defaultSystemPrompt: process.env.DEFAULT_SYSTEM_PROMPT || '',
    contextFileName: process.env.CONTEXT_FILENAME || 'CONTEXT.md',
    enableCors: process.env.ENABLE_CORS !== 'false',
    logLevel,
    rateLimit: {
      maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '60', 10),
      windowMs: 60_000, // 1 minute
      enabled: process.env.RATE_LIMIT_ENABLED !== 'false',
    },
    // New gateway configuration
    backendsConfig: process.env.BACKENDS_CONFIG || './config/backends.json',
    databasePath: process.env.DATABASE_PATH || './logs/requests.db',
    enableSQLiteLogging: process.env.ENABLE_SQLITE_LOGGING !== 'false',
  };
}

// =============================================================================
// LOGGING
// =============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function createLogger(config: ServerConfig) {
  const level = LOG_LEVELS[config.logLevel] ?? 1;
  const prefix = '[ai-gateway]';

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

// =============================================================================
// REQUEST HANDLER
// =============================================================================

interface GatewayContext {
  config: ServerConfig;
  log: ReturnType<typeof createLogger>;
  rateLimiter: RateLimiter;
  router: IntelligentRouter;
  sqliteLogger: SQLiteLogger;
  serverInfo: { version: string; startTime: Date };
}

async function handleRequest(req: Request, ctx: GatewayContext): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  ctx.log.debug(`${method} ${path}`);

  // CORS preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // Health check (bypass rate limit)
  if (path === '/health' || path === '/') {
    const stats = ctx.router.getStats();
    return jsonResponse({
      status: 'ok',
      version: ctx.serverInfo.version,
      backend: 'intelligent-gateway',
      uptime_seconds: Math.floor((Date.now() - ctx.serverInfo.startTime.getTime()) / 1000),
      routing: stats,
    });
  }

  // Queue status endpoint
  if (path === '/queue/status' && method === 'GET') {
    const stats = ctx.router.getStats();
    return jsonResponse({
      processPool: stats.processPool,
      backends: stats.backends,
    });
  }

  // Rate limit check for all other endpoints
  const rateLimitKey = getRateLimitKey(req);
  const rateLimitResult = ctx.rateLimiter.check(rateLimitKey);

  if (!rateLimitResult.allowed) {
    ctx.log.warn(`Rate limited: ${rateLimitKey}`);
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
            id: 'claude-cli-default',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'anthropic',
          },
          {
            id: 'openrouter-glm',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'openrouter',
          },
          {
            id: 'gemini-1.5-pro',
            object: 'model',
            created: Math.floor(Date.now() / 1000),
            owned_by: 'google',
          },
        ],
      },
      200,
      rateLimitHeaders(rateLimitResult)
    );
  }

  // Extract backend from URL path: /v1/{backend}/chat/completions
  const pathParts = path.split('/').filter(Boolean);
  let explicitBackend: string | undefined;

  if (pathParts.length >= 3 && pathParts[0] === 'v1' && pathParts[2] === 'chat') {
    explicitBackend = pathParts[1];
  }

  // Chat completions (supports both /v1/chat/completions and /v1/{backend}/chat/completions)
  if (path.match(/^\/v1\/([\w-]+\/)?chat\/completions$/) && method === 'POST') {
    // Check request size limit (1MB default)
    const MAX_REQUEST_SIZE = 1024 * 1024;
    const contentLength = parseInt(req.headers.get('Content-Length') || '0', 10);
    if (!Number.isFinite(contentLength) || contentLength < 0) {
      return jsonResponse(
        {
          error: {
            message: 'Invalid Content-Length header',
            type: 'invalid_request_error',
            code: 'invalid_content_length',
          },
        },
        400
      );
    }
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
      if (headerSessionId) {
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
        if (!body.session_id) {
          body.session_id = headerSessionId;
        }
      }

      // Validate request
      const validation = validateChatCompletionRequest(body);
      if (!validation.success) {
        return jsonResponse(
          {
            error: {
              message: formatValidationErrors(validation.errors || []),
              type: 'invalid_request_error',
              code: 'validation_error',
              details: { errors: validation.errors },
            },
          },
          400,
          rateLimitHeaders(rateLimitResult)
        );
      }

      // Use explicit backend from URL, or body field, or let router decide
      const preferredBackend = explicitBackend || body.backend;

      ctx.log.info(
        `Request: msgs=${body.messages?.length || 0}, backend=${preferredBackend || 'auto'}, tools=${body.tools?.length || 0}, session=${body.session_id?.slice(0, 8) || 'new'}...`
      );

      const startTime = Date.now();

      // Route request
      const decision = await ctx.router.route(body, {
        explicitBackend: preferredBackend,
        allowFallback: true,
      });

      ctx.log.debug(`Routing decision: ${decision.backend.name} - ${decision.reason}`);

      // Execute request
      let response;
      let error: string | undefined;

      try {
        response = await ctx.router.execute(body, decision);
      } catch (execError) {
        error = execError instanceof Error ? execError.message : String(execError);
        ctx.log.error(`Execution error: ${error}`);

        // Log failed request
        const duration = Date.now() - startTime;
        await ctx.sqliteLogger.log(body, null, decision, duration, undefined, error);

        return jsonResponse(
          {
            error: {
              message: error,
              type: 'server_error',
              code: 'execution_error',
            },
          },
          500,
          rateLimitHeaders(rateLimitResult)
        );
      }

      const duration = Date.now() - startTime;

      // Log successful request
      await ctx.sqliteLogger.log(body, response, decision, duration);

      ctx.log.info(
        `Completed: backend=${decision.backend.name}, session=${response.session_id?.slice(0, 8) || 'none'}..., tokens=${response.usage?.prompt_tokens || 0}→${response.usage?.completion_tokens || 0}, cost=$${decision.estimatedCost.toFixed(4)}, time=${duration}ms${decision.isFallback ? ' [DEGRADED]' : ''}`
      );

      return jsonResponse(response, 200, rateLimitHeaders(rateLimitResult));
    } catch (error) {
      // Structured error logging with context
      ctx.log.error('Request error:', {
        path,
        method,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });

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
// SERVER INITIALIZATION
// =============================================================================

async function main() {
  const config = loadConfig();
  const log = createLogger(config);
  const startTime = new Date();

  log.info('Starting Intelligent AI Gateway...');
  log.info('='.repeat(60));

  // Initialize backend registry
  log.info(`Loading backends from: ${config.backendsConfig}`);
  const backendRegistry = new BackendRegistry(config.backendsConfig!);

  // Initialize process pool registry
  const processPoolRegistry = new ProcessPoolRegistry();

  // Register Claude CLI backends with process pools
  for (const backend of backendRegistry.getToolBackends()) {
    const backendConfig = backend.getConfig();
    processPoolRegistry.registerBackend(
      backend,
      backendConfig.maxConcurrent || 10,
      backendConfig.queueSize || 50
    );
  }

  // Initialize intelligent router
  const router = new IntelligentRouter(backendRegistry, processPoolRegistry);
  log.info('Intelligent router initialized');

  // Initialize SQLite logger
  const sqliteLogger = new SQLiteLogger(
    config.databasePath!,
    config.enableSQLiteLogging
  );

  // Initialize rate limiter
  const rateLimiter = new RateLimiter(
    config.rateLimit || { maxRequests: 60, windowMs: 60_000, enabled: true }
  );
  log.info(
    `Rate limiting: ${config.rateLimit?.enabled !== false ? 'enabled' : 'disabled'} (${config.rateLimit?.maxRequests || 60}/min)`
  );

  // Run backend health checks
  log.info('Running backend health checks...');
  const healthResults = await backendRegistry.healthCheck();
  for (const [name, healthy] of healthResults.entries()) {
    log.info(`  ${name}: ${healthy ? '✓ healthy' : '✗ unavailable'}`);
  }

  // Prepare gateway context
  const ctx: GatewayContext = {
    config,
    log,
    rateLimiter,
    router,
    sqliteLogger,
    serverInfo: {
      version: '1.0.0',
      startTime,
    },
  };

  // Start server
  const server = Bun.serve({
    port: config.port,
    hostname: config.host,
    fetch: (req) => handleRequest(req, ctx),
  });

  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    log.info(`Received ${signal}, shutting down gracefully...`);

    // Stop accepting new connections
    server.stop();

    // Stop rate limiter cleanup interval
    rateLimiter.stop();

    // Close SQLite connection
    sqliteLogger.close();

    log.info('Server stopped.');
    process.exit(0);
  };

  // Register shutdown handlers
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Log startup complete
  log.info('='.repeat(60));
  log.info(`Intelligent AI Gateway v${ctx.serverInfo.version} started`);
  log.info(`Listening on http://${config.host}:${config.port}`);
  log.info('='.repeat(60));
  log.info('');
  log.info('Endpoints:');
  log.info('  POST /v1/chat/completions              - Auto-routed chat (smart backend)');
  log.info('  POST /v1/{backend}/chat/completions    - Explicit backend routing');
  log.info('  GET  /v1/models                        - List available models');
  log.info('  GET  /queue/status                     - Process pool statistics');
  log.info('  GET  /health                           - Health check + routing stats');
  log.info('');
  log.info('Available backends:');
  for (const backend of backendRegistry.getAllBackends()) {
    const config = backend.getConfig();
    log.info(`  - ${backend.name} (${backend.type}${backend.supportsTools ? ' + tools' : ''})`);
  }
  log.info('');
  log.info('Routing modes:');
  log.info('  - URL path: /v1/{backend-name}/chat/completions');
  log.info('  - Body field: {"backend": "backend-name", ...}');
  log.info('  - Auto-routing: Let gateway decide based on request characteristics');
  log.info('');
}

main().catch((err) => {
  console.error('[ai-gateway] Fatal error:', err);
  process.exit(1);
});
