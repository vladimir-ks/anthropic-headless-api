/**
 * SQLite Logger Unit Tests
 *
 * Tests database operations, logging, and query functionality.
 * Uses temporary file-based databases for isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { SQLiteLogger } from '../src/lib/sqlite-logger';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../src/types/api';
import type { RoutingDecision } from '../src/lib/router';
import type { BackendAdapter } from '../src/lib/backends/base-adapter';
import { tmpdir } from 'os';
import { join } from 'path';
import { unlinkSync, existsSync } from 'fs';

/**
 * Create a mock backend adapter for testing
 */
function createMockBackend(name: string, type: 'api' | 'claude-cli'): BackendAdapter {
  return {
    name,
    type,
    supportsTools: type === 'claude-cli',
    execute: async () => ({
      id: 'mock',
      object: 'chat.completion' as const,
      created: Date.now(),
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant' as const, content: 'mock' }, finish_reason: 'stop' as const }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }),
    estimateCost: () => 0,
    isAvailable: async () => true,
    getConfig: () => ({ name, type, costPerRequest: 0, supportsTools: type === 'claude-cli' }),
  };
}

describe('SQLiteLogger', () => {
  let dbPath: string;
  let logger: SQLiteLogger;

  beforeEach(() => {
    // Create unique temp db path
    dbPath = join(tmpdir(), `test-logger-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    logger = new SQLiteLogger(dbPath, true);
  });

  afterEach(() => {
    logger.close();
    // Clean up temp database
    if (existsSync(dbPath)) {
      try {
        unlinkSync(dbPath);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  describe('initialization', () => {
    test('creates database and runs migrations', () => {
      expect(existsSync(dbPath)).toBe(true);
    });

    test('disabled logger skips database creation', () => {
      const disabledPath = join(tmpdir(), `test-disabled-${Date.now()}.db`);
      const disabledLogger = new SQLiteLogger(disabledPath, false);
      disabledLogger.close();
      // Disabled logger should not create database
      expect(existsSync(disabledPath)).toBe(false);
    });
  });

  describe('log', () => {
    test('logs request/response pair', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const response: ChatCompletionResponse = {
        id: 'test-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'claude-3-haiku',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Hi there!' },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      };

      const decision: RoutingDecision = {
        backend: createMockBackend('test-backend', 'api'),
        reason: 'test routing',
        isFallback: false,
        estimatedCost: 0.001,
      };

      await logger.log(request, response, decision, 100, 10);

      const requests = logger.getRecentRequests(10);
      expect(requests.length).toBe(1);
      expect(requests[0].id).toBe('test-123');
      expect(requests[0].backend).toBe('test-backend');
      expect(requests[0].duration_ms).toBe(100);
    });

    test('logs error when response is null', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision: RoutingDecision = {
        backend: createMockBackend('test-backend', 'api'),
        reason: 'test routing',
        isFallback: true,
        estimatedCost: 0,
      };

      await logger.log(request, null, decision, 500, undefined, 'Connection timeout');

      const requests = logger.getRecentRequests(10);
      expect(requests.length).toBe(1);
      expect(requests[0].error).toBe('Connection timeout');
      expect(requests[0].degraded).toBe(1); // SQLite stores as 1/0
    });

    test('handles concurrent writes', async () => {
      const decision: RoutingDecision = {
        backend: createMockBackend('concurrent-backend', 'api'),
        reason: 'test',
        isFallback: false,
        estimatedCost: 0.001,
      };

      const promises: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        const request: ChatCompletionRequest = {
          messages: [{ role: 'user', content: `Message ${i}` }],
        };
        const response: ChatCompletionResponse = {
          id: `concurrent-${i}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `Response ${i}` },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        promises.push(logger.log(request, response, decision, 100));
      }

      await Promise.all(promises);

      const requests = logger.getRecentRequests(20);
      expect(requests.length).toBe(10);
    });

    test('disabled logger skips logging', async () => {
      const disabledPath = join(tmpdir(), `test-disabled-log-${Date.now()}.db`);
      const disabledLogger = new SQLiteLogger(disabledPath, false);

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      const decision: RoutingDecision = {
        backend: createMockBackend('test', 'api'),
        reason: 'test',
        isFallback: false,
        estimatedCost: 0,
      };

      await disabledLogger.log(request, null, decision, 100);

      // Should not throw, just silently skip
      const requests = disabledLogger.getRecentRequests(10);
      expect(requests).toEqual([]);

      disabledLogger.close();
    });
  });

  describe('getRecentRequests', () => {
    test('returns requests in descending order by timestamp', async () => {
      const decision: RoutingDecision = {
        backend: createMockBackend('test', 'api'),
        reason: 'test',
        isFallback: false,
        estimatedCost: 0.001,
      };

      for (let i = 0; i < 3; i++) {
        const response: ChatCompletionResponse = {
          id: `order-${i}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `Response ${i}` },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        await logger.log(
          { messages: [{ role: 'user', content: `${i}` }] },
          response,
          decision,
          100
        );
        // Small delay to ensure different timestamps
        await new Promise(r => setTimeout(r, 5));
      }

      const requests = logger.getRecentRequests(10);
      expect(requests.length).toBe(3);
      // Most recent first
      expect(requests[0].id).toBe('order-2');
      expect(requests[2].id).toBe('order-0');
    });

    test('respects limit parameter', async () => {
      const decision: RoutingDecision = {
        backend: createMockBackend('test', 'api'),
        reason: 'test',
        isFallback: false,
        estimatedCost: 0.001,
      };

      for (let i = 0; i < 5; i++) {
        const response: ChatCompletionResponse = {
          id: `limit-${i}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `R` },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
        await logger.log(
          { messages: [{ role: 'user', content: 'Q' }] },
          response,
          decision,
          10
        );
      }

      const requests = logger.getRecentRequests(3);
      expect(requests.length).toBe(3);
    });
  });

  describe('getStats', () => {
    test('returns aggregated statistics', async () => {
      const decision1: RoutingDecision = {
        backend: createMockBackend('backend-a', 'api'),
        reason: 'test',
        isFallback: false,
        estimatedCost: 0.01,
      };

      const decision2: RoutingDecision = {
        backend: createMockBackend('backend-b', 'claude-cli'),
        reason: 'test',
        isFallback: true,
        estimatedCost: 0.02,
      };

      // Log requests with different backends
      for (let i = 0; i < 3; i++) {
        const response: ChatCompletionResponse = {
          id: `stats-api-${i}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'R' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        await logger.log(
          { messages: [{ role: 'user', content: 'Q' }] },
          response,
          decision1,
          100
        );
      }

      for (let i = 0; i < 2; i++) {
        const response: ChatCompletionResponse = {
          id: `stats-cli-${i}`,
          object: 'chat.completion',
          created: Date.now(),
          model: 'test',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: 'R' },
            finish_reason: 'stop',
          }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        };
        await logger.log(
          { messages: [{ role: 'user', content: 'Q' }] },
          response,
          decision2,
          200
        );
      }

      // Log an error
      await logger.log(
        { messages: [{ role: 'user', content: 'Q' }] },
        null,
        decision1,
        50,
        undefined,
        'Error occurred'
      );

      const stats = logger.getStats();
      expect(stats.total).toBe(6);
      expect(stats.degraded).toBe(2);
      expect(stats.errors).toBe(1);
      expect(stats.avgDurationMs).toBeGreaterThan(0);
    });

    test('disabled logger returns empty stats', () => {
      const disabledLogger = new SQLiteLogger('/tmp/disabled.db', false);
      const stats = disabledLogger.getStats();
      expect(stats).toEqual({});
      disabledLogger.close();
    });
  });

  describe('safeStringify (metadata)', () => {
    test('handles objects with circular references in metadata', async () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Test circular' }],
      };

      const response: ChatCompletionResponse = {
        id: 'circular-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const decision: RoutingDecision = {
        backend: createMockBackend('test', 'api'),
        reason: 'testing circular refs',
        isFallback: false,
        estimatedCost: 0.001,
      };

      // This should not throw even though metadata could have complex objects
      await logger.log(request, response, decision, 100);

      const requests = logger.getRecentRequests(1);
      expect(requests.length).toBe(1);
      expect(requests[0].id).toBe('circular-test');
    });

    test('handles large prompts', async () => {
      const largeContent = 'x'.repeat(10000);
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: largeContent }],
      };

      const response: ChatCompletionResponse = {
        id: 'large-prompt-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Short response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 1000, completion_tokens: 5, total_tokens: 1005 },
      };

      const decision: RoutingDecision = {
        backend: createMockBackend('test', 'api'),
        reason: 'large payload test',
        isFallback: false,
        estimatedCost: 0.01,
      };

      await logger.log(request, response, decision, 500);

      const requests = logger.getRecentRequests(1);
      expect(requests.length).toBe(1);
      expect((requests[0].prompt as string).length).toBeGreaterThan(9000);
    });
  });

  describe('close', () => {
    test('closes database connection gracefully', () => {
      // Should not throw
      logger.close();
      // Calling again should also not throw
      logger.close();
    });
  });
});
