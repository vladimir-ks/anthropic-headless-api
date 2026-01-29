/**
 * Router Unit Tests
 *
 * Tests the intelligent routing logic for backend selection
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { IntelligentRouter } from '../src/lib/router';
import type { BackendAdapter } from '../src/lib/backends/base-adapter';
import type { BackendRegistry } from '../src/lib/backend-registry';
import type { ProcessPoolRegistry } from '../src/lib/process-pool';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../src/types/api';

// Mock backend adapter
class MockBackend implements BackendAdapter {
  public name: string;
  public type: 'claude-cli' | 'api';

  constructor(
    public id: string,
    private available: boolean = true,
    private _supportsTools: boolean = false,
    private costPerRequest: number = 0.01
  ) {
    this.name = id;
    this.type = _supportsTools ? 'claude-cli' : 'api';
  }

  get supportsTools(): boolean {
    return this._supportsTools;
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      id: `chatcmpl-${this.id}`,
      object: 'chat.completion',
      created: Date.now(),
      model: this.id,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
  }

  estimateCost(request: ChatCompletionRequest): number {
    return this.costPerRequest;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }
}

// Mock backend registry
class MockBackendRegistry implements BackendRegistry {
  private backends = new Map<string, BackendAdapter>();

  constructor() {
    this.backends.set('claude-cli', new MockBackend('claude-cli', true, true, 0.02));
    this.backends.set('anthropic-api', new MockBackend('anthropic-api', true, false, 0.01));
    this.backends.set('openai', new MockBackend('openai', true, false, 0.015));
  }

  getBackend(id: string): BackendAdapter | null {
    return this.backends.get(id) || null;
  }

  getAllBackends(): BackendAdapter[] {
    return Array.from(this.backends.values());
  }

  getToolBackends(): BackendAdapter[] {
    return this.getAllBackends().filter((b) => b.supportsTools);
  }

  getAPIBackends(): BackendAdapter[] {
    return this.getAllBackends().filter((b) => !b.supportsTools);
  }

  getAvailableBackends = async (): Promise<BackendAdapter[]> => {
    const backends = this.getAllBackends();
    const available = await Promise.all(
      backends.map(async (b) => ((await b.isAvailable()) ? b : null))
    );
    return available.filter((b): b is BackendAdapter => b !== null);
  };

  addBackend(backend: BackendAdapter): void {
    this.backends.set(backend.id, backend);
  }
}

// Mock process pool registry
class MockProcessPoolRegistry implements ProcessPoolRegistry {
  getPool(backendId: string): any {
    return {
      getStats: () => ({
        active: 0,
        queued: 0,
        maxConcurrent: 3,
        maxQueue: 10,
        utilization: 0,
        totalProcessed: 0,
        totalQueued: 0,
        totalFailed: 0,
      }),
    };
  }

  async execute(backendId: string, request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      id: `chatcmpl-${backendId}`,
      object: 'chat.completion',
      created: Date.now(),
      model: backendId,
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response from pool' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
  }

  getTotalStats(): any {
    return {
      active: 0,
      queued: 0,
      maxConcurrent: 3,
      maxQueue: 10,
      utilization: 0,
      totalProcessed: 0,
      totalQueued: 0,
      totalFailed: 0,
    };
  }
}

describe('IntelligentRouter', () => {
  let router: IntelligentRouter;
  let registry: MockBackendRegistry;
  let poolRegistry: MockProcessPoolRegistry;

  beforeEach(() => {
    registry = new MockBackendRegistry();
    poolRegistry = new MockProcessPoolRegistry();
    router = new IntelligentRouter(registry, poolRegistry);
  });

  describe('Explicit Backend Routing', () => {
    test('routes to explicitly requested backend when available', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request, { explicitBackend: 'openai' });

      expect(decision.backend.id).toBe('openai');
      expect(decision.reason).toContain('Explicitly requested');
      expect(decision.isFallback).toBe(false);
    });

    test('falls back to smart routing when explicit backend unavailable', async () => {
      const backend = registry.getBackend('openai') as MockBackend;
      backend.setAvailable(false);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request, { explicitBackend: 'openai' });

      // Should fall back to another backend (anthropic-api is cheaper)
      expect(decision.backend.id).not.toBe('openai');
      expect(decision.backend.id).toBe('anthropic-api');
    });

    test('returns null when explicit backend not found', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request, { explicitBackend: 'nonexistent' });

      // Should fall back to smart routing
      expect(decision.backend).toBeDefined();
    });
  });

  describe('Tool-Based Routing', () => {
    test('routes to Claude CLI when tools required (allowed_tools)', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        allowed_tools: ['Bash', 'Read'],
      };

      const decision = await router.route(request);

      expect(decision.backend.id).toBe('claude-cli');
      expect(decision.reason).toContain('Tools required');
    });

    test('routes to Claude CLI when tools required (disallowed_tools)', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        disallowed_tools: ['WebSearch'],
      };

      const decision = await router.route(request);

      expect(decision.backend.id).toBe('claude-cli');
      expect(decision.reason).toContain('Tools required');
    });

    test('routes to Claude CLI when working_directory specified', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        working_directory: '/tmp/test',
      };

      const decision = await router.route(request);

      expect(decision.backend.id).toBe('claude-cli');
    });

    test('routes to Claude CLI when context_files specified', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['file.txt'],
      };

      const decision = await router.route(request);

      expect(decision.backend.id).toBe('claude-cli');
    });
  });

  describe('Cost-Based API Routing', () => {
    test('routes to cheapest API backend when no tools required', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request);

      // anthropic-api is cheapest (0.01)
      expect(decision.backend.id).toBe('anthropic-api');
      expect(decision.reason).toContain('cost');
    });

    test('skips unavailable backends when selecting cheapest', async () => {
      const backend = registry.getBackend('anthropic-api') as MockBackend;
      backend.setAvailable(false);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request);

      // Should pick openai (0.015) since anthropic unavailable
      expect(decision.backend.id).toBe('openai');
    });
  });

  describe('Cost Estimation', () => {
    test('includes estimated cost in routing decision', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision = await router.route(request);

      expect(decision.estimatedCost).toBeGreaterThan(0);
      expect(typeof decision.estimatedCost).toBe('number');
    });
  });

  describe('Routing Statistics', () => {
    test('getStats returns backend statistics', () => {
      const stats = router.getStats();

      expect(stats.backends).toBeDefined();
      expect(stats.backends.total).toBe(3);
      expect(stats.backends.tool).toBe(1);
      expect(stats.backends.api).toBe(2);
    });

    test('includes process pool stats', () => {
      const stats = router.getStats();

      expect(stats.processPool).toBeDefined();
      expect(stats.processPool.active).toBe(0);
      expect(stats.processPool.queued).toBe(0);
    });
  });
});
