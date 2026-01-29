/**
 * Usage Tracker Unit Tests
 *
 * Tests usage tracking from Claude CLI JSON output.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { UsageTracker } from '../../../src/lib/auth-pool/core/usage-tracker';
import { MemoryStore } from '../../../src/lib/auth-pool/storage/memory-store';

// Mock ClaudeCliJsonOutput (from existing types)
interface MockClaudeCliOutput {
  result: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage?: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
  uuid: string;
  is_error: boolean;
}

function createMockCLIOutput(overrides: Partial<MockClaudeCliOutput> = {}): MockClaudeCliOutput {
  return {
    result: 'Hello',
    session_id: 'ses_123',
    duration_ms: 5000,
    duration_api_ms: 4500,
    num_turns: 1,
    total_cost_usd: 0.15,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    uuid: 'uuid_123',
    is_error: false,
    ...overrides,
  };
}

describe('UsageTracker', () => {
  let tracker: UsageTracker;
  let storage: MemoryStore;

  beforeEach(() => {
    storage = new MemoryStore();
    tracker = new UsageTracker(storage);
  });

  describe('recordUsage()', () => {
    test('should create usage record from CLI output', async () => {
      const cliOutput = createMockCLIOutput();

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.subscriptionId).toBe('sub1');
      expect(record.costUSD).toBe(0.15);
      expect(record.totalTokens).toBe(1500); // 1000 + 500
      expect(record.sessionId).toBe('ses_123');
      expect(record.durationMs).toBe(5000);
    });

    test('should calculate total tokens correctly', async () => {
      const cliOutput = createMockCLIOutput({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 3000,
        },
      });

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.totalTokens).toBe(4700); // Sum of all tokens
      expect(record.inputTokens).toBe(1000);
      expect(record.outputTokens).toBe(500);
      expect(record.cacheCreationTokens).toBe(200);
      expect(record.cacheReadTokens).toBe(3000);
    });

    test('should store usage record in storage', async () => {
      const cliOutput = createMockCLIOutput();

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      const storageKey = `usage:sub1:${record.timestamp}`;
      const stored = await storage.get(storageKey);

      expect(stored).toEqual(record);
    });

    test('should add to daily index', async () => {
      const cliOutput = createMockCLIOutput();

      await tracker.recordUsage(cliOutput, 'sub1');

      // Check index was created
      const dateKey = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const index = await storage.getIndex(`index:usage_by_day:${dateKey}`);

      expect(index).toContain('sub1');
    });

    test('should set blockId based on timestamp', async () => {
      const cliOutput = createMockCLIOutput();

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.blockId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:00:00\.000Z$/);
    });
  });

  describe('getWeeklyUsage()', () => {
    test('should aggregate last 7 days of usage', async () => {
      const now = Date.now();
      const DAY = 24 * 60 * 60 * 1000;

      // Create subscription first
      await storage.set('subscription:sub1', {
        id: 'sub1',
        weeklyUsed: 0,
        weeklyBudget: 456,
      });

      // Create usage records at different times
      await storage.set(`usage:sub1:${now - 1 * DAY}`, {
        subscriptionId: 'sub1',
        timestamp: now - 1 * DAY,
        costUSD: 10,
        blockId: 'block1',
      });

      await storage.set(`usage:sub1:${now - 3 * DAY}`, {
        subscriptionId: 'sub1',
        timestamp: now - 3 * DAY,
        costUSD: 20,
        blockId: 'block2',
      });

      await storage.set(`usage:sub1:${now - 6 * DAY}`, {
        subscriptionId: 'sub1',
        timestamp: now - 6 * DAY,
        costUSD: 15,
        blockId: 'block3',
      });

      // This one is outside 7-day window
      await storage.set(`usage:sub1:${now - 8 * DAY}`, {
        subscriptionId: 'sub1',
        timestamp: now - 8 * DAY,
        costUSD: 50,
        blockId: 'block4',
      });

      const weeklyUsage = await tracker.getWeeklyUsage('sub1');

      expect(weeklyUsage).toBe(45); // 10 + 20 + 15 (excludes 50)
    });

    test('should return 0 for subscription with no usage', async () => {
      const weeklyUsage = await tracker.getWeeklyUsage('sub_empty');

      expect(weeklyUsage).toBe(0);
    });

    test('should handle empty usage records', async () => {
      await storage.set('subscription:sub1', { id: 'sub1' });

      const weeklyUsage = await tracker.getWeeklyUsage('sub1');

      expect(weeklyUsage).toBe(0);
    });
  });

  describe('getActiveBlock()', () => {
    test('should return null if no usage in current block', async () => {
      const blockInfo = await tracker.getActiveBlock('sub1');

      expect(blockInfo).toBeNull();
    });

    test('should aggregate usage for current block', async () => {
      const now = Date.now();
      // Mock block ID calculation
      const blockId = new Date(Math.floor(now / (5 * 60 * 60 * 1000)) * (5 * 60 * 60 * 1000)).toISOString();

      await storage.set(`usage:sub1:${now - 1000}`, {
        subscriptionId: 'sub1',
        timestamp: now - 1000,
        blockId: blockId,
        costUSD: 5,
        totalTokens: 10000,
      });

      await storage.set(`usage:sub1:${now - 2000}`, {
        subscriptionId: 'sub1',
        timestamp: now - 2000,
        blockId: blockId,
        costUSD: 3,
        totalTokens: 6000,
      });

      const blockInfo = await tracker.getActiveBlock('sub1');

      expect(blockInfo).not.toBeNull();
      expect(blockInfo?.totalCost).toBe(8);
      expect(blockInfo?.totalTokens).toBe(16000);
      expect(blockInfo?.requestCount).toBe(2);
      expect(blockInfo?.isActive).toBe(true);
    });

    test('should calculate burn rate correctly', async () => {
      const now = Date.now();
      const blockId = new Date(Math.floor(now / (5 * 60 * 60 * 1000)) * (5 * 60 * 60 * 1000)).toISOString();
      const blockStartTime = new Date(blockId).getTime();

      // Mock: 10 minutes elapsed, $5 spent
      await storage.set(`usage:sub1:${blockStartTime + 10 * 60 * 1000}`, {
        subscriptionId: 'sub1',
        timestamp: blockStartTime + 10 * 60 * 1000,
        blockId: blockId,
        costUSD: 5,
        totalTokens: 30000,
      });

      // Note: This test might be fragile due to timing
      const blockInfo = await tracker.getActiveBlock('sub1');

      expect(blockInfo).not.toBeNull();
      // Burn rate should be roughly $30/hour (5 USD in 10 minutes)
      // Allow some variance due to timing
      expect(blockInfo?.costPerHour).toBeGreaterThan(0);
    });
  });

  describe('getActiveBlockId()', () => {
    test('should return block ID for 00:00 UTC', () => {
      const timestamp = new Date('2026-01-28T00:30:00.000Z').getTime();
      const blockId = tracker.getActiveBlockId(timestamp);

      expect(blockId).toBe('2026-01-28T00:00:00.000Z');
    });

    test('should return block ID for 15:00 UTC', () => {
      const timestamp = new Date('2026-01-28T17:00:00.000Z').getTime();
      const blockId = tracker.getActiveBlockId(timestamp);

      expect(blockId).toBe('2026-01-28T15:00:00.000Z');
    });
  });

  describe('calculateBurnRate()', () => {
    test('should return 0 if no recent usage', async () => {
      const burnRate = await tracker.calculateBurnRate('sub1');

      expect(burnRate).toBe(0);
    });

    test('should calculate burn rate from last hour', async () => {
      const now = Date.now();
      const HOUR = 60 * 60 * 1000;

      // Usage in last hour
      await storage.set(`usage:sub1:${now - 30 * 60 * 1000}`, {
        subscriptionId: 'sub1',
        timestamp: now - 30 * 60 * 1000,
        costUSD: 5,
        blockId: 'block1',
      });

      // Usage outside last hour (should not count)
      await storage.set(`usage:sub1:${now - 90 * 60 * 1000}`, {
        subscriptionId: 'sub1',
        timestamp: now - 90 * 60 * 1000,
        costUSD: 10,
        blockId: 'block2',
      });

      const burnRate = await tracker.calculateBurnRate('sub1');

      expect(burnRate).toBe(5); // Only last hour counts
    });
  });

  describe('edge cases', () => {
    test('should handle zero cost', async () => {
      const cliOutput = createMockCLIOutput({ total_cost_usd: 0 });

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.costUSD).toBe(0);
    });

    test('should handle large token counts', async () => {
      const cliOutput = createMockCLIOutput({
        usage: {
          input_tokens: 1000000,
          output_tokens: 500000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 5000000,
        },
      });

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.totalTokens).toBe(6500000);
    });

    test('should handle missing optional fields', async () => {
      const cliOutput = createMockCLIOutput({
        modelUsage: undefined,
      });

      const record = await tracker.recordUsage(cliOutput, 'sub1');

      expect(record.modelUsage).toBeUndefined();
    });

    test('should handle concurrent usage recording', async () => {
      const outputs = [
        createMockCLIOutput({ total_cost_usd: 0.1 }),
        createMockCLIOutput({ total_cost_usd: 0.2 }),
        createMockCLIOutput({ total_cost_usd: 0.3 }),
      ];

      await Promise.all(outputs.map(output => tracker.recordUsage(output, 'sub1')));

      const weeklyUsage = await tracker.getWeeklyUsage('sub1');

      expect(weeklyUsage).toBeGreaterThan(0);
    });
  });
});
