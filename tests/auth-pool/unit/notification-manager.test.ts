/**
 * Notification Manager Unit Tests
 *
 * Tests webhook notifications for usage events.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach, mock } from 'bun:test';
import { NotificationManager } from '../../../src/lib/auth-pool/core/notification-manager';
import type { Subscription, NotificationConfig } from '../../../src/lib/auth-pool/types';

// Mock fetch
const mockFetch = mock(() => Promise.resolve({ ok: true }));
global.fetch = mockFetch as any;

function createMockSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub1',
    email: 'user@example.com',
    type: 'claude-pro',
    configDir: '/tmp/.claude-sub1',
    currentBlockId: '2026-01-28T15:00:00.000Z',
    currentBlockCost: 10,
    blockStartTime: Date.parse('2026-01-28T15:00:00.000Z'),
    blockEndTime: Date.parse('2026-01-28T20:00:00.000Z'),
    weeklyBudget: 456,
    weeklyUsed: 200,
    assignedClients: [],
    maxClientsPerSub: 15,
    healthScore: 75,
    status: 'available',
    burnRate: 3.5,
    tokensPerMinute: 1000,
    lastUsageUpdate: Date.now(),
    lastRequestTime: Date.now(),
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('NotificationManager', () => {
  let manager: NotificationManager;
  let config: NotificationConfig;

  beforeEach(() => {
    mockFetch.mockClear();

    config = {
      rules: [
        {
          type: 'usage_threshold',
          threshold: 0.8,
          channels: ['webhook'],
          enabled: true,
        },
        {
          type: 'usage_threshold',
          threshold: 0.9,
          channels: ['webhook', 'log'],
          enabled: true,
        },
        {
          type: 'failover',
          channels: ['webhook'],
          enabled: true,
        },
        {
          type: 'rotation',
          channels: ['log'],
          enabled: true,
        },
      ],
      webhookUrl: 'https://example.com/webhook',
    };

    manager = new NotificationManager(config);
  });

  describe('checkAndNotify()', () => {
    test('should send notification when 80% threshold crossed', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 365, // 80% of 456
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toBe('https://example.com/webhook');

      const body = JSON.parse(callArgs[1].body);
      expect(body.type).toBe('usage_threshold');
      expect(body.severity).toBe('warning');
    });

    test('should send notification when 90% threshold crossed', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 410, // 90% of 456
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      // Should match 90% rule (which has 2 channels: webhook + log)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should not send notification below threshold', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 200, // 44% of 456
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should include time until exhaustion estimate', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 400,
        weeklyBudget: 456,
        burnRate: 5.0, // $5/hour
      });

      await manager.checkAndNotify(sub);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.estimatedTimeUntilExhaustion).toBeTruthy();
      expect(typeof body.data.estimatedTimeUntilExhaustion).toBe('string');
    });

    test('should not send notification if rule disabled', async () => {
      config.rules[0].enabled = false;
      manager = new NotificationManager(config);

      const sub = createMockSubscription({
        weeklyUsed: 365, // 80% of 456
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('notifyFailover()', () => {
    test('should send failover notification', async () => {
      await manager.notifyFailover({
        clientId: 'client1',
        fromSubscription: 'sub1',
        toProvider: 'openrouter-glm',
        reason: 'All subscriptions exhausted',
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.type).toBe('failover');
      expect(body.severity).toBe('warning');
      expect(body.data.clientId).toBe('client1');
      expect(body.data.toProvider).toBe('openrouter-glm');
    });

    test('should not send if failover rule disabled', async () => {
      config.rules[2].enabled = false;
      manager = new NotificationManager(config);

      await manager.notifyFailover({
        clientId: 'client1',
        fromSubscription: 'sub1',
        toProvider: 'api',
        reason: 'Test',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('notifyRotation()', () => {
    test('should send rotation notification', async () => {
      // Rotation rule uses 'log' channel, not webhook
      await manager.notifyRotation({
        clientId: 'client1',
        fromSubscription: 'sub1',
        toSubscription: 'sub2',
        reason: 'Rebalancing',
      });

      // No webhook call (only log)
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test('should not send if rotation rule disabled', async () => {
      config.rules[3].enabled = false;
      manager = new NotificationManager(config);

      await manager.notifyRotation({
        clientId: 'client1',
        fromSubscription: 'sub1',
        toSubscription: 'sub2',
        reason: 'Test',
      });

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('estimateExhaustion()', () => {
    test('should estimate hours for low burn rate', () => {
      const sub = createMockSubscription({
        weeklyUsed: 200,
        weeklyBudget: 456,
        burnRate: 2.0, // $2/hour
      });

      const estimate = manager['estimateExhaustion'](sub);

      // Remaining: 256, Burn: 2/hour = 128 hours
      expect(estimate).toContain('day');
    });

    test('should estimate minutes for high burn rate', () => {
      const sub = createMockSubscription({
        weeklyUsed: 455,
        weeklyBudget: 456,
        burnRate: 10.0, // $10/hour
      });

      const estimate = manager['estimateExhaustion'](sub);

      // Remaining: 1, Burn: 10/hour = 0.1 hours = 6 minutes
      expect(estimate).toContain('minute');
    });

    test('should return unknown for zero burn rate', () => {
      const sub = createMockSubscription({
        weeklyUsed: 100,
        weeklyBudget: 456,
        burnRate: 0,
      });

      const estimate = manager['estimateExhaustion'](sub);

      expect(estimate).toContain('Unknown');
    });
  });

  describe('send()', () => {
    test('should send to webhook channel', async () => {
      await manager['send'](
        {
          type: 'test',
          severity: 'info',
          message: 'Test message',
          data: { foo: 'bar' },
        },
        ['webhook']
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toBe('https://example.com/webhook');

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.message).toBe('Test message');
      expect(body.data.foo).toBe('bar');
    });

    test('should send to multiple channels', async () => {
      await manager['send'](
        {
          type: 'test',
          severity: 'info',
          message: 'Test',
          data: {},
        },
        ['webhook', 'log']
      );

      // Only webhook makes HTTP call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('should handle webhook failure gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        manager['send'](
          {
            type: 'test',
            severity: 'info',
            message: 'Test',
            data: {},
          },
          ['webhook']
        )
      ).resolves.toBeUndefined();
    });

    test('should skip webhook if no URL configured', async () => {
      config.webhookUrl = undefined;
      manager = new NotificationManager(config);

      await manager['send'](
        {
          type: 'test',
          severity: 'info',
          message: 'Test',
          data: {},
        },
        ['webhook']
      );

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    test('should handle subscription at exactly threshold', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 364.8, // Exactly 80% of 456
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      expect(mockFetch).toHaveBeenCalled();
    });

    test('should handle multiple thresholds for same subscription', async () => {
      const sub = createMockSubscription({
        weeklyUsed: 410, // 90% - matches both 80% and 90% rules
        weeklyBudget: 456,
      });

      await manager.checkAndNotify(sub);

      // Should send notification for highest matching threshold
      expect(mockFetch).toHaveBeenCalled();
    });

    test('should handle empty rules array', async () => {
      config.rules = [];
      manager = new NotificationManager(config);

      const sub = createMockSubscription({
        weeklyUsed: 450,
        weeklyBudget: 456,
      });

      await expect(manager.checkAndNotify(sub)).resolves.toBeUndefined();
    });
  });
});
