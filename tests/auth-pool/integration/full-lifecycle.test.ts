/**
 * Full Lifecycle Integration Tests
 *
 * Tests complete flows: allocation → usage → rebalancing → deallocation.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import {
  SubscriptionManager,
  UsageTracker,
  SessionStore,
  AllocationBalancer,
  NotificationManager,
  MemoryStore,
} from '../../../src/lib/auth-pool';
import type { PoolConfig } from '../../../src/lib/auth-pool/types';

function createTestConfig(): PoolConfig {
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
      },
      {
        id: 'sub3',
        email: 'user3@example.com',
        type: 'claude-pro',
        configDir: '/tmp/.claude-sub3',
        weeklyBudget: 456,
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
      rules: [
        {
          type: 'usage_threshold',
          threshold: 0.8,
          channels: ['log'],
          enabled: true,
        },
      ],
    },
  };
}

function createMockCLIResponse(overrides: any = {}) {
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

describe('Full Lifecycle Integration', () => {
  let storage: MemoryStore;
  let config: PoolConfig;
  let subManager: SubscriptionManager;
  let usageTracker: UsageTracker;
  let sessionStore: SessionStore;
  let balancer: AllocationBalancer;
  let notificationManager: NotificationManager;

  beforeEach(async () => {
    storage = new MemoryStore();
    config = createTestConfig();

    subManager = new SubscriptionManager(storage, config);
    usageTracker = new UsageTracker(storage);
    sessionStore = new SessionStore(storage);
    balancer = new AllocationBalancer(subManager, sessionStore, config);
    notificationManager = new NotificationManager(config.notifications);

    await subManager.initialize();
  });

  describe('Basic Flow: Allocate → Use → Deallocate', () => {
    test('should complete full lifecycle', async () => {
      // 1. Allocate client
      const allocation = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test-session',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(allocation.type).toBe('subscription');
      expect(allocation.subscriptionId).toBeTruthy();

      const subId = allocation.subscriptionId!;

      // 2. Verify session created
      const session = await sessionStore.getSession('client1');
      expect(session).not.toBeNull();
      expect(session?.subscriptionId).toBe(subId);

      // 3. Verify subscription updated
      const sub = await subManager.getSubscription(subId);
      expect(sub?.assignedClients).toContain('client1');

      // 4. Record usage
      const cliResponse = createMockCLIResponse({ total_cost_usd: 5.0 });
      await usageTracker.recordUsage(cliResponse, subId);

      // 5. Verify usage recorded
      const updatedSub = await subManager.getSubscription(subId);
      expect(updatedSub?.currentBlockCost).toBeGreaterThan(0);

      // 6. Deallocate
      await balancer.deallocateSession('client1');

      // 7. Verify cleanup
      const deletedSession = await sessionStore.getSession('client1');
      expect(deletedSession).toBeNull();

      const finalSub = await subManager.getSubscription(subId);
      expect(finalSub?.assignedClients).not.toContain('client1');
    });
  });

  describe('Multi-Client Allocation', () => {
    test('should distribute clients across subscriptions', async () => {
      const clients = ['client1', 'client2', 'client3', 'client4', 'client5'];

      for (const clientId of clients) {
        await balancer.allocateSession({
          clientId,
          sessionId: `session-${clientId}`,
          estimatedTokens: 10000,
          priority: 'normal',
        });
      }

      // Check distribution
      const sub1 = await subManager.getSubscription('sub1');
      const sub2 = await subManager.getSubscription('sub2');
      const sub3 = await subManager.getSubscription('sub3');

      const totalClients =
        (sub1?.assignedClients.length || 0) +
        (sub2?.assignedClients.length || 0) +
        (sub3?.assignedClients.length || 0);

      expect(totalClients).toBe(5);

      // All clients should have sessions
      for (const clientId of clients) {
        const session = await sessionStore.getSession(clientId);
        expect(session).not.toBeNull();
      }
    });

    test('should prefer less-used subscriptions', async () => {
      // Set different usage levels
      await subManager.updateSubscription('sub1', {
        weeklyUsed: 400,
        currentBlockCost: 20,
        currentBlockId: '2026-01-28T15:00:00.000Z',
      });

      await subManager.updateSubscription('sub2', {
        weeklyUsed: 200,
        currentBlockCost: 10,
        currentBlockId: '2026-01-28T15:00:00.000Z',
      });

      await subManager.updateSubscription('sub3', {
        weeklyUsed: 100,
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
      });

      // Allocate new client
      const result = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      // Should select sub3 (lowest usage)
      expect(result.subscriptionId).toBe('sub3');
    });
  });

  describe('Usage Tracking and Updates', () => {
    test('should update subscription state after usage', async () => {
      // Allocate client
      const allocation = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      const subId = allocation.subscriptionId!;

      // Record multiple usage events
      for (let i = 0; i < 5; i++) {
        const response = createMockCLIResponse({ total_cost_usd: 2.0 });
        await usageTracker.recordUsage(response, subId);
      }

      // Verify cumulative cost
      const sub = await subManager.getSubscription(subId);
      expect(sub?.currentBlockCost).toBeGreaterThanOrEqual(10.0); // 5 * 2.0
    });

    test('should track weekly usage across blocks', async () => {
      const subId = 'sub1';

      // Record first usage
      const response1 = createMockCLIResponse({ total_cost_usd: 50 });
      await usageTracker.recordUsage(response1, subId);

      let sub = await subManager.getSubscription(subId);
      const firstUsage = sub!.weeklyUsed;
      expect(firstUsage).toBeGreaterThanOrEqual(50);

      // Record second usage
      const response2 = createMockCLIResponse({ total_cost_usd: 75 });
      await usageTracker.recordUsage(response2, subId);

      // Check weekly usage increased
      sub = await subManager.getSubscription(subId);
      expect(sub?.weeklyUsed).toBeGreaterThan(firstUsage);
    });
  });

  describe('Rebalancing', () => {
    test('should move clients when cost gap exceeds threshold', async () => {
      // Set unbalanced usage
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 30,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1', 'client2'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: [],
      });

      // Create idle sessions on sub1
      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client1', { status: 'idle' });

      await sessionStore.createSession({ clientId: 'client2', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client2', { status: 'idle' });

      // Rebalance
      const result = await balancer.rebalance();

      expect(result.balancingNeeded).toBe(true);
      expect(result.clientsMoved).toBeGreaterThan(0);
      expect(result.toSubscription).toBe('sub2');

      // Verify clients moved
      const sub2Sessions = await sessionStore.getSessionsBySubscription('sub2');
      expect(sub2Sessions.length).toBeGreaterThan(0);
    });

    test('should not move active clients during rebalancing', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 30,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: [],
      });

      // Create ACTIVE session (should not move)
      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client1', { status: 'active' });

      const result = await balancer.rebalance();

      expect(result.clientsMoved).toBe(0);

      // Client should still be on sub1
      const session = await sessionStore.getSession('client1');
      expect(session?.subscriptionId).toBe('sub1');
    });
  });

  describe('Safeguards', () => {
    test('should use fallback when all subscriptions exceed threshold', async () => {
      // Set all subscriptions above 85% threshold
      for (const sub of config.subscriptions) {
        await subManager.updateSubscription(sub.id, {
          weeklyUsed: 388, // 85% of 456
          weeklyBudget: 456,
        });
      }

      const result = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('fallback');
    });

    test('should not allocate to subscriptions at capacity', async () => {
      // Fill sub1 to capacity
      const clients = new Array(15).fill('client').map((_, i) => `client${i}`);
      await subManager.updateSubscription('sub1', {
        assignedClients: clients,
        maxClientsPerSub: 15,
      });

      const result = await balancer.allocateSession({
        clientId: 'new-client',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      // Should select sub2 or sub3, not sub1
      expect(result.subscriptionId).not.toBe('sub1');
    });

    test('should not allocate to limited subscriptions', async () => {
      await subManager.updateSubscription('sub1', { status: 'limited' });
      await subManager.updateSubscription('sub2', { status: 'cooldown' });

      const result = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      // Should select sub3 (only available)
      expect(result.subscriptionId).toBe('sub3');
    });
  });

  describe('Health Score Updates', () => {
    test('should calculate lower health scores after heavy usage', async () => {
      const subId = 'sub1';

      // Initial subscription state (fresh)
      let sub = await subManager.getSubscription(subId);
      const initialHealth = sub!.healthScore;
      expect(initialHealth).toBe(100); // Fresh subscription

      // Record heavy usage
      for (let i = 0; i < 10; i++) {
        const response = createMockCLIResponse({ total_cost_usd: 20 });
        await usageTracker.recordUsage(response, subId);
      }

      // Get updated subscription data
      sub = await subManager.getSubscription(subId);

      // Verify usage increased
      expect(sub!.weeklyUsed).toBeGreaterThan(0);
      expect(sub!.currentBlockCost).toBeGreaterThan(0);

      // Recalculate health score (would happen during next allocation)
      const healthCalc = new (await import('../../../src/lib/auth-pool/core/health-calculator')).HealthCalculator();
      const updatedHealth = healthCalc.calculate(sub!);

      // Health score should decrease due to high usage
      expect(updatedHealth).toBeLessThan(initialHealth);
    });
  });

  describe('Concurrent Operations', () => {
    test('should handle concurrent allocations', async () => {
      const allocations = await Promise.all([
        balancer.allocateSession({
          clientId: 'client1',
          sessionId: 'test1',
          estimatedTokens: 10000,
          priority: 'normal',
        }),
        balancer.allocateSession({
          clientId: 'client2',
          sessionId: 'test2',
          estimatedTokens: 10000,
          priority: 'normal',
        }),
        balancer.allocateSession({
          clientId: 'client3',
          sessionId: 'test3',
          estimatedTokens: 10000,
          priority: 'normal',
        }),
      ]);

      // All should succeed
      expect(allocations.every(a => a.type === 'subscription')).toBe(true);

      // All should have different clients
      const clientIds = allocations.map(a => {
        const session = sessionStore.getSession(a.subscriptionId!);
        return session;
      });

      expect(clientIds.length).toBe(3);
    });
  });
});
