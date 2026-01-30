/**
 * Auth Pool Integration
 *
 * Initializes and configures the auth pool for anthropic-headless-api.
 * This module bootstraps all auth pool components.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  SubscriptionManager,
  UsageTracker,
  SessionStore,
  AllocationBalancer,
  NotificationManager,
  MemoryStore,
  type PoolConfig,
  createModuleLogger,
} from './auth-pool';
import { AuthPoolClient } from './auth-pool-client';
import { validateWebhookUrl, validateConfigPath, validateEmail } from './auth-pool/utils/security';

const logger = createModuleLogger('AuthPoolIntegration');

interface AuthPoolInstance {
  client: AuthPoolClient;
  balancer: AllocationBalancer;
  subscriptionManager: SubscriptionManager;
  usageTracker: UsageTracker;
  sessionStore: SessionStore;
  notificationManager: NotificationManager;
  shutdown: () => Promise<void>;  // NEW: Cleanup function
}

/**
 * Initialize auth pool from config file
 */
export async function initializeAuthPool(
  configPath: string = 'config/auth-pool.json'
): Promise<AuthPoolInstance | null> {
  try {
    // Load config
    if (!fs.existsSync(configPath)) {
      logger.info('Config not found, auth pool disabled', { configPath });
      return null;
    }

    const configContent = fs.readFileSync(configPath, 'utf8');
    const config: PoolConfig = JSON.parse(configContent);

    if (!config.subscriptions || config.subscriptions.length === 0) {
      logger.info('No subscriptions configured, auth pool disabled');
      return null;
    }

    // Validate webhook URL if configured
    if (config.notifications?.webhookUrl) {
      if (!validateWebhookUrl(config.notifications.webhookUrl)) {
        logger.warn('Invalid webhook URL, notifications may not work');
      }
    }

    // Validate subscription configurations
    for (const sub of config.subscriptions) {
      if (!validateConfigPath(sub.configDir)) {
        throw new Error(`Invalid config directory for subscription ${sub.id}: ${sub.configDir}`);
      }

      if (!validateEmail(sub.email)) {
        logger.warn('Invalid email format', { subscriptionId: sub.id, email: sub.email });
      }
    }

    logger.info(`Initializing with ${config.subscriptions.length} subscriptions`);

    // Initialize storage
    const storage = new MemoryStore();

    // Initialize managers
    const subscriptionManager = new SubscriptionManager(storage, config);
    const usageTracker = new UsageTracker(storage);
    const sessionStore = new SessionStore(storage);
    const balancer = new AllocationBalancer(subscriptionManager, sessionStore, config);
    const notificationManager = new NotificationManager(config.notifications);

    // Initialize subscriptions
    await subscriptionManager.initialize();

    // Create client
    const client = new AuthPoolClient({ enabled: true });
    client.setAllocator(balancer);

    // Start periodic rebalancing if enabled
    let rebalancingTimer: NodeJS.Timeout | null = null;
    if (config.rebalancing.enabled) {
      // Clear any existing timer to prevent multiple concurrent rebalancing jobs
      if (rebalancingTimer) {
        clearInterval(rebalancingTimer);
      }
      rebalancingTimer = startPeriodicRebalancing(balancer, config.rebalancing.intervalSeconds);
    }

    logger.info('Initialization complete');

    // Cleanup function to prevent memory leaks
    const shutdown = async () => {
      logger.info('Shutting down auth pool');

      // Clear rebalancing timer
      if (rebalancingTimer) {
        clearInterval(rebalancingTimer);
        rebalancingTimer = null;
      }

      // Shutdown managers
      await subscriptionManager.shutdown();

      logger.info('Shutdown complete');
    };

    return {
      client,
      balancer,
      subscriptionManager,
      usageTracker,
      sessionStore,
      notificationManager,
      shutdown,
    };
  } catch (error) {
    logger.error('Initialization failed', error as Error);
    return null;
  }
}

/**
 * Start periodic rebalancing background job
 * Returns timer handle for cleanup
 */
function startPeriodicRebalancing(
  balancer: AllocationBalancer,
  intervalSeconds: number
): NodeJS.Timeout {
  const timer = setInterval(async () => {
    try {
      const result = await balancer.rebalance();

      if (result.balancingNeeded && result.clientsMoved > 0) {
        logger.info('Rebalancing complete', {
          clientsMoved: result.clientsMoved,
          fromSubscription: result.fromSubscription,
          toSubscription: result.toSubscription,
        });
      }
    } catch (error) {
      logger.error('Rebalancing failed', error as Error);
    }
  }, intervalSeconds * 1000);

  logger.info('Periodic rebalancing started', { intervalSeconds });

  return timer;
}

/**
 * Map subscription ID to backend name
 * Helper for router integration
 */
export function getBackendForSubscription(subscriptionId: string): string {
  return `claude-cli-${subscriptionId}`;
}

/**
 * Example usage:
 *
 * ```typescript
 * // In src/index.ts:
 * const authPool = await initializeAuthPool();
 *
 * if (authPool) {
 *   app.use(async (req, res, next) => {
 *     // Allocate subscription before routing
 *     const allocation = await authPool.client.allocateAccount({
 *       sessionId: req.body.session_id,
 *       estimatedTokens: estimateTokens(req.body.messages),
 *       priority: 'normal',
 *     });
 *
 *     req.authPoolAllocation = allocation;
 *     next();
 *   });
 * }
 * ```
 */
