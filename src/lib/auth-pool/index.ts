/**
 * Auth Pool Module Index
 *
 * Public API exports for Claude Authentication Pool Manager.
 */

// Core Modules
export { SubscriptionManager } from './core/subscription-manager';
export { UsageTracker } from './core/usage-tracker';
export { SessionStore } from './core/session-store';
export { AllocationBalancer } from './core/allocation-balancer';
export { NotificationManager } from './core/notification-manager';
export { HealthCalculator } from './core/health-calculator';

// Storage
export type { StorageInterface } from './storage/storage-interface';
export { MemoryStore } from './storage/memory-store';

// Utilities
export {
  getActiveBlockId,
  getBlockStartTime,
  getBlockEndTime,
} from './utils/block-calculator';

export {
  validateSubscription,
  validateClientSession,
  validateUsageRecord,
  validateAllocationRequest,
  validateUsageReportRequest,
} from './utils/validators';

export { logger, createModuleLogger } from './utils/logger';
export type { LogLevel, LogContext, LoggerConfig } from './utils/logger';

export {
  validateWebhookUrl,
  validateConfigPath,
  sanitizeSubscriptionId,
  validateEmail,
  redactSensitive,
} from './utils/security';

// Types
export type {
  Subscription,
  SubscriptionConfig,
  SubscriptionType,
  SubscriptionStatus,
  ClientSession,
  ClientSessionStatus,
  UsageRecord,
  BlockInfo,
  PoolConfig,
  RebalancingConfig,
  NotificationConfig,
  NotificationRule,
  AllocationRequest,
  UsageReportRequest,
} from './types';
