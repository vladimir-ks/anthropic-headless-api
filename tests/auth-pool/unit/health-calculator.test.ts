/**
 * Health Calculator Unit Tests
 *
 * Tests the subscription health scoring algorithm.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { HealthCalculator } from '../../../src/lib/auth-pool/core/health-calculator';
import type { Subscription, PoolConfig } from '../../../src/lib/auth-pool/types';

// Test helper: Create mock subscription
function createMockSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub1',
    email: 'test@example.com',
    type: 'claude-pro',
    configDir: '/tmp/.claude-sub1',
    currentBlockId: null,
    currentBlockCost: 0,
    blockStartTime: null,
    blockEndTime: null,
    weeklyBudget: 456,
    weeklyUsed: 0,
    assignedClients: [],
    maxClientsPerSub: 15,
    healthScore: 100,
    status: 'available',
    burnRate: 0,
    tokensPerMinute: 0,
    lastUsageUpdate: Date.now(),
    lastRequestTime: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

// Test helper: Create mock config
function createMockConfig(): PoolConfig {
  return {
    subscriptions: [],
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

describe('HealthCalculator', () => {
  let calculator: HealthCalculator;
  let config: PoolConfig;

  beforeEach(() => {
    config = createMockConfig();
    calculator = new HealthCalculator(config);
  });

  describe('calculate()', () => {
    test('should return 100 for completely unused subscription (clamped from 110)', () => {
      const subscription = createMockSubscription({
        currentBlockCost: 0,
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      // Score would be 110 (100 + 10 idle bonus) but clamped to 100
      expect(score).toBe(100);
    });

    test('should penalize high weekly usage', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 400, // 87.7% of 456
        weeklyBudget: 456,
        currentBlockCost: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      // 100 - (87.7 * 0.5) - 0 - 0 - 0 + 10 = 66.15
      expect(score).toBeCloseTo(66.15, 1);
    });

    test('should penalize high block usage', () => {
      const subscription = createMockSubscription({
        currentBlockCost: 20, // 80% of expected 25
        currentBlockId: '2026-01-28T15:00:00.000Z', // Must have blockId if cost exists
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      // 100 - 0 - (80 * 0.3) - 0 - 0 + 0 = 76
      expect(score).toBeCloseTo(76, 1);
    });

    test('should penalize client count (5 points per client)', () => {
      const subscription = createMockSubscription({
        assignedClients: ['c1', 'c2', 'c3'],
        weeklyUsed: 0,
        currentBlockCost: 0,
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      // 100 - 0 - 0 - (3 * 5) - 0 + 10 = 95
      expect(score).toBe(95);
    });

    test('should penalize high burn rate', () => {
      const subscription = createMockSubscription({
        burnRate: 7.0, // 4 above baseline of 3
        weeklyUsed: 0,
        currentBlockCost: 0,
        assignedClients: [],
      });

      const score = calculator.calculate(subscription);

      // 100 - 0 - 0 - 0 - ((7 - 3) * 2) + 10 = 102, clamped to 100
      expect(score).toBe(100);
    });

    test('should not penalize burn rate below baseline', () => {
      const subscription = createMockSubscription({
        burnRate: 2.0, // Below baseline of 3
        weeklyUsed: 0,
        currentBlockCost: 0,
        assignedClients: [],
      });

      const score = calculator.calculate(subscription);

      // 100 - 0 - 0 - 0 - 0 + 10 = 110, clamped to 100
      expect(score).toBe(100);
    });

    test('should combine all penalties correctly', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 200, // 43.9% of 456
        weeklyBudget: 456,
        currentBlockCost: 10, // 40% of expected 25
        currentBlockId: '2026-01-28T15:00:00.000Z', // Must have blockId if cost exists
        assignedClients: ['c1', 'c2'],
        burnRate: 5.0, // 2 above baseline
      });

      const score = calculator.calculate(subscription);

      // 100 - (43.86 * 0.5) - (40 * 0.3) - (2 * 5) - ((5 - 3) * 2) + 0
      // = 100 - 21.93 - 12 - 10 - 4 = 52.07
      expect(score).toBeCloseTo(52.07, 1);
    });

    test('should clamp score to 0-100 range (lower bound)', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 450, // 98.7%
        currentBlockCost: 25,
        assignedClients: ['c1', 'c2', 'c3', 'c4', 'c5'],
        burnRate: 10.0,
      });

      const score = calculator.calculate(subscription);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('should clamp score to 0-100 range (upper bound)', () => {
      // Score would be 110 with idle bonus, should clamp to 100
      const subscription = createMockSubscription({
        currentBlockCost: 0,
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('should not give idle bonus if block has cost', () => {
      const subscription = createMockSubscription({
        currentBlockCost: 1, // Non-zero
        currentBlockId: '2026-01-28T15:00:00.000Z', // Must have blockId if cost exists
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const score = calculator.calculate(subscription);

      // 100 - 0 - (4 * 0.3) - 0 - 0 + 0 = 98.8 (no idle bonus)
      expect(score).toBeCloseTo(98.8, 1);
    });
  });

  describe('explainScore()', () => {
    test('should provide detailed breakdown with explanations', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 200,
        weeklyBudget: 456,
        currentBlockCost: 10,
        currentBlockId: '2026-01-28T15:00:00.000Z', // Must have blockId if cost exists
        assignedClients: ['c1', 'c2'],
        burnRate: 5.0,
      });

      const breakdown = calculator.explainScore(subscription);

      expect(breakdown.finalScore).toBeCloseTo(52.07, 1);
      expect(breakdown.components.weeklyUsagePenalty).toBeCloseTo(-21.9, 1);
      expect(breakdown.components.blockUsagePenalty).toBeCloseTo(-12, 1);
      expect(breakdown.components.clientCountPenalty).toBe(-10);
      expect(breakdown.components.burnRatePenalty).toBe(-4);
      expect(breakdown.components.idleBonus).toBe(0);

      expect(breakdown.explanation).toBeInstanceOf(Array);
      expect(breakdown.explanation.length).toBeGreaterThan(3);
      expect(breakdown.explanation[0]).toBe('Base score: 100');
    });

    test('should include idle bonus in explanation when applicable', () => {
      const subscription = createMockSubscription({
        currentBlockCost: 0,
        weeklyUsed: 0,
        assignedClients: [],
        burnRate: 0,
      });

      const breakdown = calculator.explainScore(subscription);

      expect(breakdown.components.idleBonus).toBe(10);
      expect(breakdown.explanation).toContain('Idle bonus: +10 points');
    });

    test('should round percentages in explanation', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 200.5,
        weeklyBudget: 456,
      });

      const breakdown = calculator.explainScore(subscription);

      // Should have "Weekly usage (44%)" not "Weekly usage (43.97368421052632%)"
      const weeklyLine = breakdown.explanation.find(line => line.includes('Weekly usage'));
      expect(weeklyLine).toMatch(/Weekly usage \(\d{1,3}%\)/);
    });
  });

  describe('edge cases', () => {
    test('should handle zero weekly budget gracefully', () => {
      const subscription = createMockSubscription({
        weeklyUsed: 0,
        weeklyBudget: 0, // Division by zero risk
      });

      // Should not throw
      expect(() => calculator.calculate(subscription)).not.toThrow();
    });

    test('should handle negative values (data corruption scenario)', () => {
      const subscription = createMockSubscription({
        weeklyUsed: -10, // Invalid but possible due to data corruption
        currentBlockCost: -5,
      });

      const score = calculator.calculate(subscription);

      // Should still return valid score
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    });

    test('should handle very large client counts', () => {
      const subscription = createMockSubscription({
        assignedClients: new Array(1000).fill('client'), // 1000 clients
      });

      const score = calculator.calculate(subscription);

      // Score should be clamped to 0
      expect(score).toBe(0);
    });
  });
});
