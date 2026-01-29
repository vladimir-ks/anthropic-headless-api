/**
 * Subscription Manager
 *
 * Manages subscription lifecycle (CRUD operations).
 * Based on PSEUDOCODE.md specification.
 */

import type { StorageInterface } from '../storage/storage-interface';
import type { PoolConfig, Subscription, SubscriptionConfig } from '../types';
import { validateSubscription } from '../utils/validators';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SubscriptionManager');

export class SubscriptionManager {
  private cache: Map<string, Subscription> = new Map();

  constructor(
    private storage: StorageInterface,
    private config: PoolConfig
  ) {}

  /**
   * Initialize subscription manager
   * Loads subscriptions from config and creates/updates in storage
   */
  async initialize(): Promise<void> {
    logger.info(`Initializing with ${this.config.subscriptions.length} subscriptions`);

    for (const subConfig of this.config.subscriptions) {
      const subscription = this.createSubscriptionFromConfig(subConfig);

      // Check if subscription already exists in storage
      const existing = await this.storage.get<Subscription>(`subscription:${subConfig.id}`);

      if (!existing) {
        // New subscription - initialize
        await this.storage.set(`subscription:${subConfig.id}`, subscription);
        this.cache.set(subConfig.id, subscription);
        logger.info('Created subscription', { subscriptionId: subConfig.id });
      } else {
        // Existing - merge config updates
        const merged = this.mergeSubscriptionConfig(existing, subConfig);
        await this.storage.set(`subscription:${subConfig.id}`, merged);
        this.cache.set(subConfig.id, merged);
        logger.info('Updated subscription', { subscriptionId: subConfig.id });
      }
    }

    logger.info(`Initialization complete: ${this.config.subscriptions.length} subscriptions`);
  }

  /**
   * Get subscription by ID
   * Uses cache first, falls back to storage
   */
  async getSubscription(id: string): Promise<Subscription | null> {
    // Check cache first
    if (this.cache.has(id)) {
      return this.cache.get(id) ?? null;
    }

    // Cache miss - load from storage
    const subscription = await this.storage.get<Subscription>(`subscription:${id}`);

    if (subscription) {
      this.cache.set(id, subscription);
    }

    return subscription;
  }

  /**
   * Get all subscriptions
   */
  async getAllSubscriptions(): Promise<Subscription[]> {
    const subscriptions: Subscription[] = [];

    for (const subConfig of this.config.subscriptions) {
      const subscription = await this.getSubscription(subConfig.id);
      if (subscription) {
        subscriptions.push(subscription);
      }
    }

    return subscriptions;
  }

  /**
   * Update subscription fields
   * Validates, persists, and updates cache
   */
  async updateSubscription(id: string, updates: Partial<Subscription>): Promise<void> {
    const subscription = await this.getSubscription(id);

    if (!subscription) {
      throw new Error(`Subscription not found: ${id}`);
    }

    // Merge updates
    const updated = { ...subscription, ...updates };

    // Validate
    const validated = validateSubscription(updated);

    // Persist
    await this.storage.set(`subscription:${id}`, validated);

    // Update cache
    this.cache.set(id, validated);

    logger.debug('Updated subscription', { subscriptionId: id });
  }

  /**
   * Health check all subscriptions
   * Returns map of subscription ID → is healthy
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const subscriptions = await this.getAllSubscriptions();

    for (const sub of subscriptions) {
      const isHealthy = this.isSubscriptionHealthy(sub);
      results.set(sub.id, isHealthy);
    }

    return results;
  }

  /**
   * Shutdown subscription manager
   * Clears cache and closes storage
   */
  async shutdown(): Promise<void> {
    // Clear cache
    this.cache.clear();

    // Close storage
    await this.storage.close();

    logger.info('Shutdown complete');
  }

  /**
   * Create subscription from config (initial state)
   */
  private createSubscriptionFromConfig(config: SubscriptionConfig): Subscription {
    return {
      id: config.id,
      email: config.email,
      type: config.type,
      configDir: config.configDir,
      currentBlockId: null,
      currentBlockCost: 0,
      blockStartTime: null,
      blockEndTime: null,
      weeklyBudget: config.weeklyBudget,
      weeklyUsed: 0,
      assignedClients: [],
      maxClientsPerSub: config.maxClientsPerSub ?? this.config.maxClientsPerSubscription,
      healthScore: 100,
      status: 'available',
      burnRate: 0,
      tokensPerMinute: 0,
      lastUsageUpdate: Date.now(),
      lastRequestTime: 0,
      createdAt: Date.now(),
    };
  }

  /**
   * Merge config updates into existing subscription
   * Preserves runtime state, updates config fields
   */
  private mergeSubscriptionConfig(
    existing: Subscription,
    config: SubscriptionConfig
  ): Subscription {
    // Update config-derived fields only
    return {
      ...existing,
      email: config.email,
      configDir: config.configDir,
      weeklyBudget: config.weeklyBudget,
      maxClientsPerSub: config.maxClientsPerSub ?? existing.maxClientsPerSub,
    };
  }

  /**
   * Check if subscription is healthy
   * Used by health check endpoint
   */
  private isSubscriptionHealthy(sub: Subscription): boolean {
    // Health checks
    if (sub.status === 'limited' || sub.status === 'cooldown') {
      return false;
    }

    const weeklyPercent = sub.weeklyUsed / sub.weeklyBudget;
    if (weeklyPercent >= this.config.weeklyBudgetThreshold) {
      return false;
    }

    if (sub.assignedClients.length >= sub.maxClientsPerSub) {
      return false;
    }

    return true;
  }
}
