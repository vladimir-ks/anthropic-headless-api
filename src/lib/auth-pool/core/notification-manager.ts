/**
 * Notification Manager
 *
 * Handles webhook notifications for usage events, failovers, and rotations.
 * Based on PSEUDOCODE.md specification.
 */

import type { Subscription, NotificationConfig } from '../types';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('NotificationManager');

interface NotificationPayload {
  type: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  subscriptionId?: string;
  data: any;
}

export class NotificationManager {
  constructor(private config: NotificationConfig) {}

  /**
   * Check usage and send notifications if thresholds crossed
   */
  async checkAndNotify(subscription: Subscription): Promise<void> {
    const weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget;

    // Get enabled threshold rules
    const thresholdRules = this.config.rules.filter(
      r => r.type === 'usage_threshold' && r.enabled
    );

    // Check each threshold rule
    for (const rule of thresholdRules) {
      if (weeklyPercent >= rule.threshold!) {
        const payload: NotificationPayload = {
          type: 'usage_threshold',
          severity: 'warning',
          subscriptionId: subscription.id,
          message: `Subscription ${subscription.id} at ${(weeklyPercent * 100).toFixed(0)}% weekly budget`,
          data: {
            weeklyUsed: subscription.weeklyUsed,
            weeklyBudget: subscription.weeklyBudget,
            weeklyPercent: (weeklyPercent * 100).toFixed(1),
            blockCost: subscription.currentBlockCost,
            burnRate: subscription.burnRate,
            estimatedTimeUntilExhaustion: this.estimateExhaustion(subscription),
            threshold: (rule.threshold! * 100).toFixed(0),
          },
        };

        await this.send(payload, rule.channels);
      }
    }
  }

  /**
   * Notify when failover occurs
   */
  async notifyFailover(event: {
    clientId: string;
    fromSubscription: string;
    toProvider: string;
    reason: string;
  }): Promise<void> {
    const rule = this.config.rules.find(r => r.type === 'failover' && r.enabled);

    if (!rule) {
      return;
    }

    const payload: NotificationPayload = {
      type: 'failover',
      severity: 'warning',
      message: `Client ${event.clientId} failed over from ${event.fromSubscription} to ${event.toProvider}`,
      data: event,
    };

    await this.send(payload, rule.channels);
  }

  /**
   * Notify when rotation happens
   */
  async notifyRotation(event: {
    clientId: string;
    fromSubscription: string;
    toSubscription: string;
    reason: string;
  }): Promise<void> {
    const rule = this.config.rules.find(r => r.type === 'rotation' && r.enabled);

    if (!rule) {
      return;
    }

    const payload: NotificationPayload = {
      type: 'rotation',
      severity: 'info',
      message: `Client ${event.clientId} rotated from ${event.fromSubscription} to ${event.toSubscription}`,
      data: event,
    };

    await this.send(payload, rule.channels);
  }

  /**
   * Estimate time until subscription exhausted
   */
  private estimateExhaustion(sub: Subscription): string {
    const remaining = sub.weeklyBudget - sub.weeklyUsed;

    if (sub.burnRate === 0) {
      return 'Unknown (no activity)';
    }

    const hoursRemaining = remaining / sub.burnRate;

    if (hoursRemaining < 1) {
      return `${Math.round(hoursRemaining * 60)} minutes`;
    } else if (hoursRemaining < 24) {
      return `${Math.round(hoursRemaining)} hours`;
    } else {
      return `${Math.round(hoursRemaining / 24)} days`;
    }
  }

  /**
   * Send notification to configured channels
   */
  private async send(notification: NotificationPayload, channels: string[]): Promise<void> {
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'webhook':
            if (this.config.webhookUrl) {
              await fetch(this.config.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(notification),
              });
            }
            break;

          case 'log':
            console.log(`[NOTIFICATION] ${notification.message}`, notification.data);
            break;

          default:
            logger.warn(`Unknown notification channel: ${channel}`);
        }
      } catch (error) {
        logger.error(`Failed to send notification via ${channel}`, error as Error);
      }
    }
  }
}
