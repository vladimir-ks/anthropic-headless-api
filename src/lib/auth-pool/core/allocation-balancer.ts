/**
 * Allocation Balancer
 *
 * Handles subscription selection and periodic rebalancing.
 * Based on PSEUDOCODE.md specification.
 */

import type { SubscriptionManager } from './subscription-manager';
import type { SessionStore } from './session-store';
import type { PoolConfig, Subscription, AllocationRequest } from '../types';
import { HealthCalculator } from './health-calculator';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('AllocationBalancer');

interface AllocationResult {
  type: 'subscription' | 'fallback';
  subscriptionId?: string;
  configDir?: string;
  reason: string;
}

interface RebalanceResult {
  balancingNeeded: boolean;
  clientsMoved: number;
  fromSubscription?: string;
  toSubscription?: string;
}

export class AllocationBalancer {
  private healthCalculator: HealthCalculator;

  constructor(
    private subscriptionManager: SubscriptionManager,
    private sessionStore: SessionStore,
    private config: PoolConfig
  ) {
    this.healthCalculator = new HealthCalculator(config);
  }

  /**
   * Select best subscription for allocation
   * Returns subscription or fallback based on availability
   */
  async selectSubscription(request: AllocationRequest): Promise<AllocationResult> {
    // Get all subscriptions
    let subscriptions = await this.subscriptionManager.getAllSubscriptions();

    // Filter by safeguards
    const available = subscriptions.filter(sub => this.isSubscriptionAvailable(sub));

    if (available.length === 0) {
      // No subscriptions available
      if (this.config.fallbackWhenExhausted) {
        return {
          type: 'fallback',
          reason: 'All subscriptions unavailable, using fallback',
        };
      } else {
        throw new Error('No subscriptions available and fallback is disabled');
      }
    }

    // Calculate health scores
    for (const sub of available) {
      sub.healthScore = this.healthCalculator.calculate(sub);
    }

    // Sort by health score (highest first)
    available.sort((a, b) => b.healthScore - a.healthScore);

    // Select best subscription
    const selected = available[0];

    return {
      type: 'subscription',
      subscriptionId: selected.id,
      configDir: selected.configDir,
      reason: `Selected subscription with health score ${selected.healthScore.toFixed(1)}`,
    };
  }

  /**
   * Allocate session to a subscription
   * Creates client session and updates subscription
   */
  async allocateSession(request: AllocationRequest & { clientId: string }): Promise<AllocationResult> {
    const result = await this.selectSubscription(request);

    // If fallback, don't create session
    if (result.type === 'fallback') {
      return result;
    }

    const subscriptionId = result.subscriptionId!;

    // Create client session
    await this.sessionStore.createSession({
      clientId: request.clientId,
      subscriptionId: subscriptionId,
    });

    // Update subscription
    const subscription = await this.subscriptionManager.getSubscription(subscriptionId);

    if (subscription) {
      const updatedClients = [...subscription.assignedClients, request.clientId];

      await this.subscriptionManager.updateSubscription(subscriptionId, {
        assignedClients: updatedClients,
        lastRequestTime: Date.now(),
      });
    }

    logger.info('Allocated session', {
      clientId: request.clientId,
      subscriptionId,
    });

    return result;
  }

  /**
   * Periodic rebalancing
   * Moves idle clients from high-cost to low-cost subscriptions
   */
  async rebalance(): Promise<RebalanceResult> {
    if (!this.config.rebalancing.enabled) {
      return {
        balancingNeeded: false,
        clientsMoved: 0,
      };
    }

    // Get all subscriptions
    const subscriptions = await this.subscriptionManager.getAllSubscriptions();

    // Filter active subscriptions with current block
    const active = subscriptions.filter(sub => sub.currentBlockId !== null);

    if (active.length < 2) {
      // Need at least 2 subscriptions to balance
      return {
        balancingNeeded: false,
        clientsMoved: 0,
      };
    }

    // Sort by current block cost
    active.sort((a, b) => a.currentBlockCost - b.currentBlockCost);

    const leastUsed = active[0];
    const mostUsed = active[active.length - 1];

    const costGap = mostUsed.currentBlockCost - leastUsed.currentBlockCost;

    if (costGap < this.config.rebalancing.costGapThreshold) {
      // No balancing needed
      return {
        balancingNeeded: false,
        clientsMoved: 0,
      };
    }

    logger.info('Rebalancing needed', { costGap: costGap.toFixed(2) });

    // Get idle clients from most-used subscription
    const sessions = await this.sessionStore.getSessionsBySubscription(mostUsed.id);
    const idleSessions = sessions.filter(s => s.status === 'idle');

    if (idleSessions.length === 0) {
      logger.debug('No idle clients to move');
      return {
        balancingNeeded: true,
        clientsMoved: 0,
      };
    }

    // Calculate how many clients can be moved
    const availableSlots = leastUsed.maxClientsPerSub - leastUsed.assignedClients.length;
    const maxToMove = Math.min(
      idleSessions.length,
      availableSlots,
      this.config.rebalancing.maxClientsToMovePerCycle
    );

    if (maxToMove === 0) {
      logger.debug('Destination subscription at capacity');
      return {
        balancingNeeded: true,
        clientsMoved: 0,
      };
    }

    // Move clients
    let moved = 0;
    for (let i = 0; i < maxToMove; i++) {
      const session = idleSessions[i];

      try {
        // Reassign session
        await this.sessionStore.reassignSession(session.id, leastUsed.id);

        // Update subscription client lists
        await this.updateSubscriptionClientLists(mostUsed.id, leastUsed.id, session.id);

        moved++;
      } catch (error) {
        logger.error(`Failed to move client`, error as Error, { clientId: session.id });
      }
    }

    logger.info(`Moved ${moved} clients`, {
      fromSubscription: mostUsed.id,
      toSubscription: leastUsed.id,
      clientsMoved: moved,
    });

    return {
      balancingNeeded: true,
      clientsMoved: moved,
      fromSubscription: mostUsed.id,
      toSubscription: leastUsed.id,
    };
  }

  /**
   * Deallocate session
   * Removes session and unassigns from subscription
   */
  async deallocateSession(clientId: string): Promise<void> {
    const session = await this.sessionStore.getSession(clientId);

    if (!session) {
      // Session doesn't exist - no-op
      return;
    }

    const subscriptionId = session.subscriptionId;

    // Delete session
    await this.sessionStore.deleteSession(clientId);

    // Update subscription
    const subscription = await this.subscriptionManager.getSubscription(subscriptionId);

    if (subscription) {
      const updatedClients = subscription.assignedClients.filter(id => id !== clientId);

      await this.subscriptionManager.updateSubscription(subscriptionId, {
        assignedClients: updatedClients,
      });
    }

    logger.info('Deallocated session', { clientId, subscriptionId });
  }

  /**
   * Check if subscription is available for allocation
   * Applies safeguards
   */
  private isSubscriptionAvailable(subscription: Subscription): boolean {
    // Safeguard 1: Status check
    if (subscription.status === 'limited' || subscription.status === 'cooldown') {
      return false;
    }

    // Safeguard 2: Weekly budget threshold
    const weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget;
    if (weeklyPercent >= this.config.weeklyBudgetThreshold) {
      return false;
    }

    // Safeguard 3: Client capacity
    if (subscription.assignedClients.length >= subscription.maxClientsPerSub) {
      return false;
    }

    return true;
  }

  /**
   * Update subscription client lists after reassignment
   */
  private async updateSubscriptionClientLists(
    fromSubId: string,
    toSubId: string,
    clientId: string
  ): Promise<void> {
    // Remove from source subscription
    const fromSub = await this.subscriptionManager.getSubscription(fromSubId);
    if (fromSub) {
      const updatedFromClients = fromSub.assignedClients.filter(id => id !== clientId);
      await this.subscriptionManager.updateSubscription(fromSubId, {
        assignedClients: updatedFromClients,
      });
    }

    // Add to destination subscription
    const toSub = await this.subscriptionManager.getSubscription(toSubId);
    if (toSub) {
      const updatedToClients = [...toSub.assignedClients, clientId];
      await this.subscriptionManager.updateSubscription(toSubId, {
        assignedClients: updatedToClients,
      });
    }
  }
}
