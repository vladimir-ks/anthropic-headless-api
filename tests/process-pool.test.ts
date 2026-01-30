/**
 * Process Pool Unit Tests
 *
 * Tests queue management, shutdown behavior, and resource limits
 */

import { describe, test, expect } from 'bun:test';
import { ClaudeProcessPool, ProcessPoolRegistry } from '../src/lib/process-pool';
import type { BackendAdapter } from '../src/lib/backends/base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../src/types/api';

// Mock backend adapter
class MockBackend implements BackendAdapter {
  public name = 'mock-cli';
  public type: 'claude-cli' = 'claude-cli';
  public supportsTools = true;
  private delay: number;
  private shouldFail: boolean;

  constructor(delay: number = 10, shouldFail: boolean = false) {
    this.delay = delay;
    this.shouldFail = shouldFail;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    await new Promise((resolve) => setTimeout(resolve, this.delay));
    if (this.shouldFail) {
      throw new Error('Backend execution failed');
    }
    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Test response' },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
  }

  estimateCost(): number {
    return 0.01;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  getConfig() {
    return {
      name: 'mock-cli',
      type: 'claude-cli' as const,
      provider: 'anthropic' as const,
      costPerRequest: 0.01,
      supportsTools: true,
    };
  }
}

function createRequest(): ChatCompletionRequest {
  return {
    messages: [{ role: 'user', content: 'Hello' }],
  };
}

describe('ClaudeProcessPool', () => {
  describe('Basic Execution', () => {
    test('executes request immediately when under capacity', async () => {
      const backend = new MockBackend(10);
      const pool = new ClaudeProcessPool(backend, 3, 10);

      const response = await pool.execute(createRequest());

      expect(response.choices[0].message.content).toBe('Test response');
      await pool.shutdown();
    });

    test('queues request when at capacity', async () => {
      const backend = new MockBackend(50);
      const pool = new ClaudeProcessPool(backend, 1, 10);

      // Execute two requests in parallel (first takes slot, second queues)
      const [r1, r2] = await Promise.all([
        pool.execute(createRequest()),
        pool.execute(createRequest()),
      ]);

      expect(r1.choices).toBeDefined();
      expect(r2.choices).toBeDefined();
      await pool.shutdown();
    });
  });

  describe('Queue Limits', () => {
    test('rejects when queue is full', async () => {
      const backend = new MockBackend(1000);
      const pool = new ClaudeProcessPool(backend, 1, 2);

      // Start requests that will fill capacity and queue
      const p1 = pool.execute(createRequest()); // Active
      const p2 = pool.execute(createRequest()); // Queued 1
      const p3 = pool.execute(createRequest()); // Queued 2

      // Fourth should reject immediately (queue full)
      await expect(pool.execute(createRequest())).rejects.toThrow('queue full');

      // Shutdown pool - this will reject queued items
      const shutdownPromise = pool.shutdown();

      // Wait for all to settle (p1 may complete, p2/p3 will be rejected by shutdown)
      await Promise.allSettled([p1, p2, p3, shutdownPromise]);
    });
  });

  describe('Stats', () => {
    test('tracks stats correctly', async () => {
      const backend = new MockBackend(10);
      const pool = new ClaudeProcessPool(backend, 2, 5);

      await pool.execute(createRequest());
      await pool.execute(createRequest());

      const stats = pool.getStats();
      expect(stats.totalProcessed).toBe(2);
      expect(stats.maxConcurrent).toBe(2);
      expect(stats.maxQueue).toBe(5);

      await pool.shutdown();
    });
  });

  describe('Shutdown', () => {
    test('rejects new requests after shutdown started', async () => {
      const backend = new MockBackend(10);
      const pool = new ClaudeProcessPool(backend, 2, 5);

      // Start shutdown (don't await yet)
      const shutdownPromise = pool.shutdown();

      // New requests should be rejected
      await expect(pool.execute(createRequest())).rejects.toThrow('shutting down');

      await shutdownPromise;
    });

    test('returns shutdown stats', async () => {
      const backend = new MockBackend(10);
      const pool = new ClaudeProcessPool(backend, 2, 5);

      const result = await pool.shutdown();

      expect(result).toHaveProperty('rejected');
      expect(result).toHaveProperty('timedOut');
    });
  });

  describe('Error Handling', () => {
    test('handles backend execution failure', async () => {
      const backend = new MockBackend(10, true); // shouldFail = true
      const pool = new ClaudeProcessPool(backend, 2, 5);

      await expect(pool.execute(createRequest())).rejects.toThrow('Backend execution failed');

      await pool.shutdown();
    });
  });
});

describe('ProcessPoolRegistry', () => {
  test('registers and executes through pool', async () => {
    const registry = new ProcessPoolRegistry();
    const backend = new MockBackend(10);

    registry.registerBackend(backend, 2, 5);

    const response = await registry.execute('mock-cli', createRequest());
    expect(response.choices).toBeDefined();

    await registry.shutdown();
  });

  test('rejects non-CLI backends', () => {
    const registry = new ProcessPoolRegistry();
    const backend = {
      name: 'api-backend',
      type: 'api' as const,
      supportsTools: false,
      execute: async () => ({} as ChatCompletionResponse),
      estimateCost: () => 0,
      isAvailable: async () => true,
      getConfig: () => ({
        name: 'api',
        type: 'api' as const,
        provider: 'openai' as const,
        costPerRequest: 0.01,
        supportsTools: false,
      }),
    };

    expect(() => registry.registerBackend(backend, 2, 5)).toThrow('Only Claude CLI backends');
  });

  test('aggregates stats from all pools', async () => {
    const registry = new ProcessPoolRegistry();

    // Create two backends
    const backend1 = new MockBackend(10);
    backend1.name = 'cli-1';
    const backend2 = new MockBackend(10);
    backend2.name = 'cli-2';

    registry.registerBackend(backend1, 2, 5);
    registry.registerBackend(backend2, 3, 10);

    const stats = registry.getTotalStats();
    expect(stats.maxConcurrent).toBe(5); // 2 + 3
    expect(stats.maxQueue).toBe(15); // 5 + 10

    await registry.shutdown();
  });

  test('throws for unknown backend', async () => {
    const registry = new ProcessPoolRegistry();

    await expect(registry.execute('nonexistent', createRequest())).rejects.toThrow('No process pool');
  });
});
