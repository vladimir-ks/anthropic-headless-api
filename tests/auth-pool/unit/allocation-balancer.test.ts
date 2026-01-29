/**
 * Allocation Balancer Unit Tests
 *
 * Tests subscription selection and periodic rebalancing logic.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { AllocationBalancer } from '../../../src/lib/auth-pool/core/allocation-balancer';
import { SubscriptionManager } from '../../../src/lib/auth-pool/core/subscription-manager';
import { SessionStore } from '../../../src/lib/auth-pool/core/session-store';
import { HealthCalculator } from '../../../src/lib/auth-pool/core/health-calculator';
import { MemoryStore } from '../../../src/lib/auth-pool/storage/memory-store';
import type { PoolConfig } from '../../../src/lib/auth-pool/types';

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
      rules: [],
    },
  };
}

describe('AllocationBalancer', () => {
  let balancer: AllocationBalancer;
  let subManager: SubscriptionManager;
  let sessionStore: SessionStore;
  let storage: MemoryStore;
  let config: PoolConfig;

  beforeEach(async () => {
    storage = new MemoryStore();
    config = createMockConfig();
    subManager = new SubscriptionManager(storage, config);
    sessionStore = new SessionStore(storage);
    balancer = new AllocationBalancer(subManager, sessionStore, config);

    // Initialize subscriptions
    await subManager.initialize();
  });

  describe('selectSubscription()', () => {
    test('should select subscription with highest health score', async () => {
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

      const result = await balancer.selectSubscription({
        sessionId: 'test-session',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('subscription');
      expect(result.subscriptionId).toBe('sub3'); // Lowest usage
    });

    test('should exclude subscriptions exceeding weekly budget threshold', async () => {
      // sub1: 87% of budget (above 85% threshold)
      await subManager.updateSubscription('sub1', {
        weeklyUsed: 397, // 87% of 456
        weeklyBudget: 456,
      });

      // sub2: 50% of budget (below threshold)
      await subManager.updateSubscription('sub2', {
        weeklyUsed: 228,
        weeklyBudget: 456,
      });

      const result = await balancer.selectSubscription({
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.subscriptionId).not.toBe('sub1');
      expect(['sub2', 'sub3']).toContain(result.subscriptionId);
    });

    test('should exclude subscriptions at client capacity', async () => {
      // Fill sub1 to capacity
      const clients = new Array(15).fill('client').map((_, i) => `client${i}`);
      await subManager.updateSubscription('sub1', {
        assignedClients: clients,
        maxClientsPerSub: 15,
      });

      const result = await balancer.selectSubscription({
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.subscriptionId).not.toBe('sub1');
    });

    test('should exclude limited/cooldown subscriptions', async () => {
      await subManager.updateSubscription('sub1', { status: 'limited' });
      await subManager.updateSubscription('sub2', { status: 'cooldown' });

      const result = await balancer.selectSubscription({
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.subscriptionId).toBe('sub3');
    });

    test('should return fallback when all subscriptions unavailable', async () => {
      // Make all subscriptions unavailable
      await subManager.updateSubscription('sub1', { status: 'limited' });
      await subManager.updateSubscription('sub2', { status: 'limited' });
      await subManager.updateSubscription('sub3', { status: 'limited' });

      const result = await balancer.selectSubscription({
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('fallback');
      expect(result.reason).toContain('unavailable');
    });

    test('should return fallback when fallbackWhenExhausted is true', async () => {
      config.fallbackWhenExhausted = true;

      await subManager.updateSubscription('sub1', { weeklyUsed: 450 });
      await subManager.updateSubscription('sub2', { weeklyUsed: 450 });
      await subManager.updateSubscription('sub3', { weeklyUsed: 450 });

      const result = await balancer.selectSubscription({
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('fallback');
    });

    test('should throw when fallbackWhenExhausted is false and no subscriptions available', async () => {
      config.fallbackWhenExhausted = false;

      await subManager.updateSubscription('sub1', { status: 'limited' });
      await subManager.updateSubscription('sub2', { status: 'limited' });
      await subManager.updateSubscription('sub3', { status: 'limited' });

      await expect(
        balancer.selectSubscription({
          sessionId: 'test',
          estimatedTokens: 10000,
          priority: 'normal',
        })
      ).rejects.toThrow('No subscriptions available');
    });
  });

  describe('allocateSession()', () => {
    test('should create session and assign to subscription', async () => {
      const result = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test-session',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('subscription');
      expect(result.subscriptionId).toBeTruthy();

      // Check session created
      const session = await sessionStore.getSession('client1');
      expect(session).not.toBeNull();
      expect(session?.subscriptionId).toBe(result.subscriptionId);

      // Check subscription updated
      const sub = await subManager.getSubscription(result.subscriptionId!);
      expect(sub?.assignedClients).toContain('client1');
    });

    test('should update subscription lastRequestTime', async () => {
      const before = Date.now();

      await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      const sub = await subManager.getSubscription('sub1');
      expect(sub?.lastRequestTime).toBeGreaterThanOrEqual(before);
    });

    test('should not create session for fallback allocation', async () => {
      // Force fallback
      await subManager.updateSubscription('sub1', { status: 'limited' });
      await subManager.updateSubscription('sub2', { status: 'limited' });
      await subManager.updateSubscription('sub3', { status: 'limited' });

      const result = await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      expect(result.type).toBe('fallback');

      // Session should not exist
      const session = await sessionStore.getSession('client1');
      expect(session).toBeNull();
    });
  });

  describe('rebalance()', () => {
    test('should do nothing if cost gap below threshold', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 10,
        currentBlockId: '2026-01-28T15:00:00.000Z',
      });
      await subManager.updateSubscription('sub2', {
        currentBlockCost: 12,
        currentBlockId: '2026-01-28T15:00:00.000Z',
      });

      // Create sessions
      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.createSession({ clientId: 'client2', subscriptionId: 'sub2' });

      // Cost gap = 2 (below threshold of 5)
      const result = await balancer.rebalance();

      expect(result.clientsMoved).toBe(0);
      expect(result.balancingNeeded).toBe(false);
    });

    test('should move idle clients from high-cost to low-cost subscription', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 20,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1', 'client2'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 10,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: [],
      });

      // Create idle sessions on sub1
      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client1', { status: 'idle' });

      await sessionStore.createSession({ clientId: 'client2', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client2', { status: 'idle' });

      // Cost gap = 10 (above threshold)
      const result = await balancer.rebalance();

      expect(result.clientsMoved).toBeGreaterThan(0);
      expect(result.balancingNeeded).toBe(true);

      // Check clients moved to sub2
      const sub2Sessions = await sessionStore.getSessionsBySubscription('sub2');
      expect(sub2Sessions.length).toBeGreaterThan(0);
    });

    test('should not move active clients', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 20,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: [],
      });

      // Create active session (should not move)
      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client1', { status: 'active' });

      const result = await balancer.rebalance();

      expect(result.clientsMoved).toBe(0);

      // Client should still be on sub1
      const session = await sessionStore.getSession('client1');
      expect(session?.subscriptionId).toBe('sub1');
    });

    test('should respect maxClientsToMovePerCycle', async () => {
      config.rebalancing.maxClientsToMovePerCycle = 2;

      await subManager.updateSubscription('sub1', {
        currentBlockCost: 30,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1', 'client2', 'client3', 'client4'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: [],
      });

      // Create 4 idle sessions
      for (let i = 1; i <= 4; i++) {
        await sessionStore.createSession({
          clientId: `client${i}`,
          subscriptionId: 'sub1',
        });
        await sessionStore.updateSession(`client${i}`, { status: 'idle' });
      }

      const result = await balancer.rebalance();

      // Should only move 2 clients (max per cycle)
      expect(result.clientsMoved).toBe(2);
    });

    test('should not overload destination subscription', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 30,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1', 'client2', 'client3'],
      });

      await subManager.updateSubscription('sub2', {
        currentBlockCost: 5,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: new Array(14).fill('client').map((_, i) => `existing${i}`),
        maxClientsPerSub: 15,
      });

      // Create idle sessions
      for (let i = 1; i <= 3; i++) {
        await sessionStore.createSession({
          clientId: `client${i}`,
          subscriptionId: 'sub1',
        });
        await sessionStore.updateSession(`client${i}`, { status: 'idle' });
      }

      const result = await balancer.rebalance();

      // Should only move 1 client (sub2 has capacity for 1 more)
      expect(result.clientsMoved).toBeLessThanOrEqual(1);
    });
  });

  describe('deallocateSession()', () => {
    test('should remove session and unassign from subscription', async () => {
      // Allocate first
      await balancer.allocateSession({
        clientId: 'client1',
        sessionId: 'test',
        estimatedTokens: 10000,
        priority: 'normal',
      });

      const session = await sessionStore.getSession('client1');
      const subId = session!.subscriptionId;

      // Deallocate
      await balancer.deallocateSession('client1');

      // Session should be deleted
      const deletedSession = await sessionStore.getSession('client1');
      expect(deletedSession).toBeNull();

      // Subscription should not have client
      const sub = await subManager.getSubscription(subId);
      expect(sub?.assignedClients).not.toContain('client1');
    });

    test('should not throw if session does not exist', async () => {
      await expect(
        balancer.deallocateSession('nonexistent')
      ).resolves.toBeUndefined();
    });
  });

  describe('edge cases', () => {
    test('should handle concurrent allocation requests', async () => {
      await Promise.all([
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

      // All sessions should be created
      const session1 = await sessionStore.getSession('client1');
      const session2 = await sessionStore.getSession('client2');
      const session3 = await sessionStore.getSession('client3');

      expect(session1).not.toBeNull();
      expect(session2).not.toBeNull();
      expect(session3).not.toBeNull();
    });

    test('should handle rebalancing when no idle clients exist', async () => {
      await subManager.updateSubscription('sub1', {
        currentBlockCost: 30,
        currentBlockId: '2026-01-28T15:00:00.000Z',
        assignedClients: ['client1'],
      });

      await sessionStore.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await sessionStore.updateSession('client1', { status: 'active' });

      const result = await balancer.rebalance();

      expect(result.clientsMoved).toBe(0);
    });
  });
});
