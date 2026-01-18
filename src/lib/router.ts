/**
 * Intelligent Routing System
 *
 * Routes requests to optimal backend based on:
 * - Tool requirements (Claude CLI for tools, API for simple chat)
 * - Cost optimization (prefer cheaper backends when possible)
 * - Backend availability
 * - Explicit backend preference (URL path or body field)
 */

import type { ChatCompletionRequest, ChatCompletionResponse } from '../types/api';
import type { BackendAdapter } from './backends/base-adapter';
import type { BackendRegistry } from './backend-registry';
import type { ProcessPoolRegistry } from './process-pool';

export interface RoutingDecision {
  backend: BackendAdapter;
  reason: string;
  isFallback: boolean;
  estimatedCost: number;
}

interface RoutingOptions {
  explicitBackend?: string; // From URL path or body
  allowFallback?: boolean; // Allow fallback to API when CLI queue full
}

export class IntelligentRouter {
  constructor(
    private backendRegistry: BackendRegistry,
    private processPoolRegistry: ProcessPoolRegistry
  ) {}

  /**
   * Route a request to the optimal backend
   */
  async route(
    request: ChatCompletionRequest,
    options: RoutingOptions = {}
  ): Promise<RoutingDecision> {
    // 1. If explicit backend specified, use it (unless unavailable)
    if (options.explicitBackend) {
      const backend = this.backendRegistry.getBackend(options.explicitBackend);
      if (backend) {
        const available = await backend.isAvailable();
        if (available) {
          return {
            backend,
            reason: `Explicitly requested: ${options.explicitBackend}`,
            isFallback: false,
            estimatedCost: backend.estimateCost(request),
          };
        }
        // Explicit backend unavailable - will fall through to smart routing
        console.warn(
          `[Router] Requested backend ${options.explicitBackend} unavailable, using smart routing`
        );
      }
    }

    // 2. Determine if tools are required
    const requiresTools = this.requiresTools(request);

    if (requiresTools) {
      // MUST use Claude CLI backend (tools required)
      return this.routeToClaudeCLI(request, options.allowFallback);
    }

    // 3. No tools required - use smart API routing
    return this.routeToAPI(request);
  }

  /**
   * Execute request via selected backend
   */
  async execute(
    request: ChatCompletionRequest,
    decision: RoutingDecision
  ): Promise<ChatCompletionResponse> {
    const startTime = Date.now();

    try {
      let response: ChatCompletionResponse;

      // If backend is Claude CLI, use process pool
      if (decision.backend.type === 'claude-cli') {
        response = await this.processPoolRegistry.execute(
          decision.backend.name,
          request
        );
      } else {
        // Direct API execution
        response = await decision.backend.execute(request);
      }

      const duration = Date.now() - startTime;
      console.log(
        `[Router] Request completed via ${decision.backend.name} in ${duration}ms`
      );

      return response;
    } catch (error) {
      console.error(
        `[Router] Request failed via ${decision.backend.name}:`,
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  /**
   * Determine if request requires tools
   */
  private requiresTools(request: ChatCompletionRequest): boolean {
    // Explicit tool specification
    if (request.tools && request.tools.length > 0) {
      return true;
    }

    // Working directory specified (needs file access)
    if (request.working_directory) {
      return true;
    }

    return false;
  }

  /**
   * Route to Claude CLI backend (with process pool)
   */
  private async routeToClaudeCLI(
    request: ChatCompletionRequest,
    allowFallback: boolean = true
  ): Promise<RoutingDecision> {
    // Get all Claude CLI backends
    const toolBackends = this.backendRegistry.getToolBackends();

    if (toolBackends.length === 0) {
      throw new Error('No Claude CLI backends available for tool use');
    }

    // Try to find an available backend with capacity
    for (const backend of toolBackends) {
      const available = await backend.isAvailable();
      if (!available) continue;

      // Check if process pool has capacity
      const pool = this.processPoolRegistry.getPool(backend.name);
      if (pool) {
        const stats = pool.getStats();
        const hasCapacity = stats.active < stats.maxConcurrent || stats.queued < stats.maxQueue;

        if (hasCapacity) {
          return {
            backend,
            reason: `Tools required, Claude CLI available with capacity`,
            isFallback: false,
            estimatedCost: backend.estimateCost(request),
          };
        }
      }
    }

    // All Claude CLI backends at capacity
    if (allowFallback) {
      // Fallback to API (without tools)
      console.warn('[Router] All Claude CLI backends at capacity, falling back to API (no tools)');
      const apiDecision = await this.routeToAPI(request);
      return {
        ...apiDecision,
        isFallback: true,
        reason: `Claude CLI queue full, degraded to API: ${apiDecision.reason}`,
      };
    }

    // No fallback allowed - queue request (will throw if queue full)
    const defaultBackend = toolBackends[0];
    return {
      backend: defaultBackend,
      reason: `Tools required, queuing for ${defaultBackend.name}`,
      isFallback: false,
      estimatedCost: defaultBackend.estimateCost(request),
    };
  }

  /**
   * Route to cheapest available API backend
   */
  private async routeToAPI(request: ChatCompletionRequest): Promise<RoutingDecision> {
    const apiBackends = this.backendRegistry.getAPIBackends();

    if (apiBackends.length === 0) {
      throw new Error('No API backends available');
    }

    // Filter by availability
    const availableBackends = await this.filterAvailable(apiBackends);

    if (availableBackends.length === 0) {
      throw new Error('No API backends currently available');
    }

    // Apply smart routing logic
    const backend = this.selectOptimalAPIBackend(request, availableBackends);

    return {
      backend,
      reason: `Smart routing: ${backend.name} (cost-optimal for this request)`,
      isFallback: false,
      estimatedCost: backend.estimateCost(request),
    };
  }

  /**
   * Select optimal API backend based on request characteristics
   */
  private selectOptimalAPIBackend(
    request: ChatCompletionRequest,
    backends: BackendAdapter[]
  ): BackendAdapter {
    // Estimate token count
    const estimatedTokens = this.estimateTokens(request.messages);

    // Long context? Prefer Gemini (2M tokens)
    if (estimatedTokens > 100000) {
      const gemini = backends.find((b) => b.name.includes('gemini'));
      if (gemini) {
        return gemini;
      }
    }

    // Reasoning/thinking task? Prefer Claude Sonnet
    const modelLower = request.model?.toLowerCase() || '';
    if (modelLower.includes('sonnet') || modelLower.includes('thinking')) {
      const sonnet = backends.find((b) => b.name.includes('sonnet'));
      if (sonnet) {
        return sonnet;
      }
    }

    // Default: Cost optimization - pick cheapest
    backends.sort((a, b) => a.estimateCost(request) - b.estimateCost(request));
    return backends[0];
  }

  /**
   * Filter backends by availability (parallel checks)
   */
  private async filterAvailable(backends: BackendAdapter[]): Promise<BackendAdapter[]> {
    const availabilityChecks = backends.map(async (backend) => {
      try {
        const available = await backend.isAvailable();
        return available ? backend : null;
      } catch {
        return null;
      }
    });

    const results = await Promise.all(availabilityChecks);
    return results.filter((b): b is BackendAdapter => b !== null);
  }

  /**
   * Estimate token count from messages
   */
  private estimateTokens(messages: Array<{ role: string; content: string }>): number {
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    // Rough estimate: ~4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      processPool: this.processPoolRegistry.getTotalStats(),
      backends: {
        total: this.backendRegistry.getAllBackends().length,
        tool: this.backendRegistry.getToolBackends().length,
        api: this.backendRegistry.getAPIBackends().length,
      },
    };
  }
}
