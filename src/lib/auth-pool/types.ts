/**
 * Auth Pool Type Definitions
 *
 * All TypeScript interfaces for the authentication pool module.
 * Based on DATA_MODELS.md specification.
 */

// ============================================================================
// Core Entities
// ============================================================================

export type SubscriptionStatus = 'available' | 'approaching' | 'limited' | 'cooldown';
export type SubscriptionType = 'claude-pro' | 'claude-max' | 'api';
export type SessionStatus = 'active' | 'idle' | 'stale';

export interface Subscription {
  // Identity
  id: string;
  email: string;
  type: SubscriptionType;
  configDir: string;

  // Current 5-hour block tracking
  currentBlockId: string | null;
  currentBlockCost: number;
  blockStartTime: number | null;
  blockEndTime: number | null;

  // Weekly budget tracking
  weeklyBudget: number;
  weeklyUsed: number;

  // Allocation state
  assignedClients: string[];
  maxClientsPerSub: number;

  // Health metrics
  healthScore: number;
  status: SubscriptionStatus;

  // Burn rate
  burnRate: number;
  tokensPerMinute: number;

  // Metadata
  lastUsageUpdate: number;
  lastRequestTime: number;
  createdAt: number;
}

export interface ClientSession {
  // Identity
  id: string;
  subscriptionId: string;

  // Allocation metadata
  allocatedAt: number;
  lastActivity: number;
  status: SessionStatus;

  // Usage tracking
  sessionCost: number;
  sessionTokens: number;
  requestCount: number;

  // Client metadata (optional)
  clientIp?: string;
  userAgent?: string;
}

export interface UsageRecord {
  // Identity
  subscriptionId: string;
  timestamp: number;
  blockId: string;

  // Cost and tokens
  costUSD: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  totalTokens: number;

  // Model breakdown
  modelUsage?: ModelUsageDetail[];

  // Request metadata
  sessionId?: string;
  durationMs?: number;
  uuid?: string;
}

export interface ModelUsageDetail {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}

export interface BlockInfo {
  id: string;
  startTime: number;
  endTime: number;
  isActive: boolean;

  // Aggregated usage
  totalCost: number;
  totalTokens: number;
  requestCount: number;

  // Burn rate
  tokensPerMinute: number;
  costPerHour: number;

  // Projection
  projectedCost?: number;
  remainingMinutes?: number;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface AllocationRequest {
  sessionId?: string;
  estimatedTokens: number;
  priority?: 'high' | 'normal' | 'low';
}

export interface AllocationResult {
  type: 'subscription' | 'fallback';

  // If type === 'subscription'
  subscriptionId?: string;
  configDir?: string;
  subscriptionEmail?: string;
  sessionId: string;
  expiresAt?: number;

  // If type === 'fallback'
  fallbackProvider?: string;
  reason: string;

  // Metadata
  healthScore?: number;
  weeklyPercentUsed?: number;
}

export interface UsageReportRequest {
  subscriptionId: string;
  sessionId: string;
  cost: number;
  tokens: TokenUsage;
  durationMs?: number;
  model?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// ============================================================================
// Event Types
// ============================================================================

export type NotificationEvent =
  | RotationEvent
  | FailoverEvent
  | ThresholdEvent
  | LimitReachedEvent;

export interface RotationEvent {
  type: 'rotation';
  timestamp: number;
  sessionId: string;
  fromSubscription: string;
  toSubscription: string;
  reason: string;
}

export interface FailoverEvent {
  type: 'failover';
  timestamp: number;
  sessionId: string;
  fromSubscription: string;
  toProvider: string;
  reason: string;
}

export interface ThresholdEvent {
  type: 'usage_threshold';
  timestamp: number;
  subscriptionId: string;
  weeklyUsed: number;
  weeklyBudget: number;
  percentUsed: number;
  estimatedTimeRemaining: string;
}

export interface LimitReachedEvent {
  type: 'limit_reached';
  timestamp: number;
  subscriptionId: string;
  limitType: 'weekly' | 'block' | 'clients';
  currentValue: number;
  limitValue: number;
}

export interface RebalanceReport {
  timestamp: number;
  subscriptionsEvaluated: number;
  imbalanceDetected: boolean;

  clientsMoved: number;
  movementDetails?: Array<{
    sessionId: string;
    fromSubscription: string;
    toSubscription: string;
    reason: string;
  }>;

  healthScoresBefore: Record<string, number>;
  healthScoresAfter: Record<string, number>;

  durationMs: number;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface PoolConfig {
  subscriptions: SubscriptionConfig[];

  maxClientsPerSubscription: number;
  weeklyBudgetThreshold: number;
  fallbackWhenExhausted: boolean;

  rebalancing: {
    enabled: boolean;
    intervalSeconds: number;
    costGapThreshold: number;
    maxClientsToMovePerCycle: number;
  };

  notifications: {
    webhookUrl?: string;
    sentryDsn?: string;
    rules: NotificationRule[];
  };
}

export interface SubscriptionConfig {
  id: string;
  email: string;
  type: SubscriptionType;
  configDir: string;
  weeklyBudget: number;
  maxClientsPerSub?: number;
}

export interface NotificationRule {
  type: 'usage_threshold' | 'failover' | 'rotation' | 'limit_reached';
  threshold?: number;
  channels: ('webhook' | 'log' | 'sentry')[];
  enabled: boolean;
}

// ============================================================================
// Extracted Configuration Sub-Types
// ============================================================================

export interface RebalancingConfig {
  enabled: boolean;
  intervalSeconds: number;
  costGapThreshold: number;
  maxClientsToMovePerCycle: number;
}

export interface NotificationConfig {
  webhookUrl?: string;
  sentryDsn?: string;
  rules: NotificationRule[];
}

// Type alias for backward compatibility
export type ClientSessionStatus = SessionStatus;

// ============================================================================
// Helper Types
// ============================================================================

export interface HealthScoreBreakdown {
  finalScore: number;
  components: {
    weeklyUsagePenalty: number;
    blockUsagePenalty: number;
    clientCountPenalty: number;
    burnRatePenalty: number;
    idleBonus: number;
  };
  explanation: string[];
}
