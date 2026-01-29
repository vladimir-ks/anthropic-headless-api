/**
 * Subscription Manager Unit Tests
 *
 * Tests subscription CRUD and lifecycle management.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SubscriptionManager } from '../../../src/lib/auth-pool/core/subscription-manager';
import { MemoryStore } from '../../../src/lib/auth-pool/storage/memory-store';
import type { PoolConfig, Subscription } from '../../../src/lib/auth-pool/types';

function createMockConfig(): PoolConfig {
  return {
    subscriptions: [
      {
        id: 'sub1',
        email: 'user1@example.com',
        type: 'claude-pro',
        configDir: '/tmp/.claude-sub1',
        weeklyBudget: 456,
      },
      {
        id: 'sub2',
        email: 'user2@example.com',
        type: 'claude-pro',
        configDir: '/tmp/.claude-sub2',
        weeklyBudget: 456,
        maxClientsPerSub: 20, // Override default
      },
    ],
    maxClientsPerSubscription: 15,
    weeklyBudgetThreshold: 0.85,
    fallbackWhenExhausted: true,
    rebalancing: {
      enabled: true,
      intervalSeconds: 300,
      costGapThreshold: 5.0,
      maxClientsToMovePerCycle: 3,
    },
    notifications: {
      rules: [],
    },
  };
}

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;
  let storage: MemoryStore;
  let config: PoolConfig;

  beforeEach(async () => {
    storage = new MemoryStore();
    config = createMockConfig();
    manager = new SubscriptionManager(storage, config);
  });

  describe('initialize()', () => {
    test('should create subscriptions from config', async () => {
      await manager.initialize();

      const sub1 = await manager.getSubscription('sub1');
      const sub2 = await manager.getSubscription('sub2');

      expect(sub1).not.toBeNull();
      expect(sub2).not.toBeNull();
      expect(sub1?.email).toBe('user1@example.com');
      expect(sub2?.email).toBe('user2@example.com');
    });

    test('should initialize subscriptions with default values', async () => {
      await manager.initialize();

      const sub = await manager.getSubscription('sub1');

      expect(sub?.currentBlockId).toBeNull();
      expect(sub?.currentBlockCost).toBe(0);
      expect(sub?.weeklyUsed).toBe(0);
      expect(sub?.assignedClients).toEqual([]);
      expect(sub?.healthScore).toBe(100);
      expect(sub?.status).toBe('available');
      expect(sub?.burnRate).toBe(0);
    });

    test('should respect config-specific maxClientsPerSub', async () => {
      await manager.initialize();

      const sub1 = await manager.getSubscription('sub1');
      const sub2 = await manager.getSubscription('sub2');

      expect(sub1?.maxClientsPerSub).toBe(15); // Default
      expect(sub2?.maxClientsPerSub).toBe(20); // Override
    });

    test('should not duplicate subscriptions on re-initialization', async () => {
      await manager.initialize();
      await manager.initialize(); // Second call

      const sub = await manager.getSubscription('sub1');
      expect(sub).not.toBeNull();

      // Should not create duplicates
      const keys = await storage.list('subscription:');
      expect(keys).toHaveLength(2);
    });

    test('should merge config updates on re-initialization', async () => {
      await manager.initialize();

      // Manually update storage
      const sub = await manager.getSubscription('sub1');
      if (sub) {
        sub.weeklyUsed = 100;
        await storage.set('subscription:sub1', sub);
      }

      // Update config
      config.subscriptions[0].weeklyBudget = 500;

      // Re-initialize
      const manager2 = new SubscriptionManager(storage, config);
      await manager2.initialize();

      const updated = await manager2.getSubscription('sub1');

      // Should preserve runtime state
      expect(updated?.weeklyUsed).toBe(100);
      // Should update config fields
      expect(updated?.weeklyBudget).toBe(500);
    });
  });

  describe('getSubscription()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should return subscription if exists', async () => {
      const sub = await manager.getSubscription('sub1');

      expect(sub).not.toBeNull();
      expect(sub?.id).toBe('sub1');
    });

    test('should return null if not exists', async () => {
      const sub = await manager.getSubscription('nonexistent');

      expect(sub).toBeNull();
    });

    test('should use cache on subsequent calls', async () => {
      // First call - loads from storage
      const sub1 = await manager.getSubscription('sub1');

      // Manually modify storage (shouldn't affect cached value)
      await storage.set('subscription:sub1', { ...sub1, email: 'modified@example.com' });

      // Second call - should return cached value
      const sub2 = await manager.getSubscription('sub1');

      expect(sub2?.email).toBe('user1@example.com'); // Original value
    });
  });

  describe('getAllSubscriptions()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should return all subscriptions', async () => {
      const subs = await manager.getAllSubscriptions();

      expect(subs).toHaveLength(2);
      expect(subs.map(s => s.id)).toContain('sub1');
      expect(subs.map(s => s.id)).toContain('sub2');
    });

    test('should return empty array if no subscriptions', async () => {
      const emptyConfig: PoolConfig = { ...config, subscriptions: [] };
      const emptyManager = new SubscriptionManager(storage, emptyConfig);
      await emptyManager.initialize();

      const subs = await emptyManager.getAllSubscriptions();

      expect(subs).toEqual([]);
    });
  });

  describe('updateSubscription()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should update subscription fields', async () => {
      await manager.updateSubscription('sub1', {
        weeklyUsed: 250,
        currentBlockCost: 15,
        status: 'approaching',
      });

      const sub = await manager.getSubscription('sub1');

      expect(sub?.weeklyUsed).toBe(250);
      expect(sub?.currentBlockCost).toBe(15);
      expect(sub?.status).toBe('approaching');
    });

    test('should update cache', async () => {
      await manager.updateSubscription('sub1', { weeklyUsed: 300 });

      // Should be in cache
      const sub = await manager.getSubscription('sub1');
      expect(sub?.weeklyUsed).toBe(300);
    });

    test('should persist to storage', async () => {
      await manager.updateSubscription('sub1', { weeklyUsed: 350 });

      // Read directly from storage
      const stored = await storage.get<Subscription>('subscription:sub1');
      expect(stored?.weeklyUsed).toBe(350);
    });

    test('should throw if subscription not found', async () => {
      await expect(
        manager.updateSubscription('nonexistent', { weeklyUsed: 100 })
      ).rejects.toThrow('Subscription not found');
    });

    test('should allow partial updates', async () => {
      const before = await manager.getSubscription('sub1');
      const originalEmail = before?.email;

      await manager.updateSubscription('sub1', { weeklyUsed: 100 });

      const after = await manager.getSubscription('sub1');

      expect(after?.weeklyUsed).toBe(100);
      expect(after?.email).toBe(originalEmail); // Unchanged
    });
  });

  describe('healthCheck()', () => {
    beforeEach(async () => {
      await manager.initialize();
    });

    test('should return true for healthy subscriptions', async () => {
      const results = await manager.healthCheck();

      expect(results.get('sub1')).toBe(true);
      expect(results.get('sub2')).toBe(true);
    });

    test('should return false for limited subscriptions', async () => {
      await manager.updateSubscription('sub1', { status: 'limited' });

      const results = await manager.healthCheck();

      expect(results.get('sub1')).toBe(false);
    });

    test('should return false for subscriptions exceeding budget threshold', async () => {
      // 87% of 456 = 396.72
      await manager.updateSubscription('sub1', {
        weeklyUsed: 400,
        weeklyBudget: 456,
      });

      const results = await manager.healthCheck();

      expect(results.get('sub1')).toBe(false);
    });

    test('should return false for subscriptions at client capacity', async () => {
      const clients = new Array(15).fill('client').map((_, i) => `client${i}`);
      await manager.updateSubscription('sub1', {
        assignedClients: clients,
        maxClientsPerSub: 15,
      });

      const results = await manager.healthCheck();

      expect(results.get('sub1')).toBe(false);
    });

    test('should return false for cooldown subscriptions', async () => {
      await manager.updateSubscription('sub1', { status: 'cooldown' });

      const results = await manager.healthCheck();

      expect(results.get('sub1')).toBe(false);
    });
  });

  describe('shutdown()', () => {
    test('should clear cache and close storage', async () => {
      await manager.initialize();
      await manager.getSubscription('sub1'); // Load into cache

      await manager.shutdown();

      // Storage should be closed (data cleared in MemoryStore)
      const sub = await storage.get('subscription:sub1');
      expect(sub).toBeNull();
    });

    test('should not throw on shutdown', async () => {
      await manager.initialize();

      await expect(manager.shutdown()).resolves.toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('should handle empty config', async () => {
      const emptyConfig: PoolConfig = {
        ...config,
        subscriptions: [],
      };

      const emptyManager = new SubscriptionManager(storage, emptyConfig);
      await emptyManager.initialize();

      const subs = await emptyManager.getAllSubscriptions();
      expect(subs).toEqual([]);
    });

    test('should handle concurrent updates', async () => {
      await manager.initialize();

      // Concurrent updates to same subscription
      await Promise.all([
        manager.updateSubscription('sub1', { weeklyUsed: 100 }),
        manager.updateSubscription('sub1', { currentBlockCost: 20 }),
      ]);

      const sub = await manager.getSubscription('sub1');

      // Both updates should be applied (one will overwrite the other)
      expect(sub?.weeklyUsed === 100 || sub?.currentBlockCost === 20).toBe(true);
    });

    test('should validate subscription data', async () => {
      await manager.initialize();

      // Invalid status value should throw
      await expect(
        manager.updateSubscription('sub1', { status: 'invalid' as any })
      ).rejects.toThrow();
    });
  });
});
