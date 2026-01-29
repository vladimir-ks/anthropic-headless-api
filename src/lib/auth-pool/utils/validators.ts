/**
 * Data Validators
 *
 * Zod schemas for runtime validation of auth pool data.
 * Based on DATA_MODELS.md specification.
 */

import { z } from 'zod';

// ============================================================================
// Core Entity Schemas
// ============================================================================

export const SubscriptionSchema = z.object({
  // Identity
  id: z.string().min(1),
  email: z.string().email(),
  type: z.enum(['claude-pro', 'claude-max', 'api']),
  configDir: z.string(),

  // Current 5-hour block tracking
  currentBlockId: z.string().nullable(),
  currentBlockCost: z.number().nonnegative(),
  blockStartTime: z.number().nullable(),
  blockEndTime: z.number().nullable(),

  // Weekly budget tracking
  weeklyBudget: z.number().positive(),
  weeklyUsed: z.number().nonnegative(),

  // Allocation state
  assignedClients: z.array(z.string()),
  maxClientsPerSub: z.number().int().positive(),

  // Health metrics
  healthScore: z.number().min(0).max(100),
  status: z.enum(['available', 'approaching', 'limited', 'cooldown']),

  // Burn rate
  burnRate: z.number().nonnegative(),
  tokensPerMinute: z.number().nonnegative(),

  // Metadata
  lastUsageUpdate: z.number(),
  lastRequestTime: z.number(),
  createdAt: z.number(),
});

export const ClientSessionSchema = z.object({
  // Identity
  id: z.string().min(1),
  subscriptionId: z.string().min(1),

  // Allocation metadata
  allocatedAt: z.number(),
  lastActivity: z.number(),
  status: z.enum(['active', 'idle', 'stale']),

  // Usage tracking
  sessionCost: z.number().nonnegative(),
  sessionTokens: z.number().int().nonnegative(),
  requestCount: z.number().int().nonnegative(),

  // Client metadata (optional)
  clientIp: z.string().optional(),
  userAgent: z.string().optional(),
});

export const UsageRecordSchema = z.object({
  // Identity
  subscriptionId: z.string().min(1),
  timestamp: z.number().positive(),
  blockId: z.string(),

  // Cost and tokens
  costUSD: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),

  // Model breakdown (optional)
  modelUsage: z
    .array(
      z.object({
        model: z.string(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
        cost: z.number().nonnegative(),
      })
    )
    .optional(),

  // Request metadata
  sessionId: z.string().optional(),
  durationMs: z.number().optional(),
  uuid: z.string().optional(),
});

// ============================================================================
// Request/Response Schemas
// ============================================================================

export const AllocationRequestSchema = z.object({
  sessionId: z.string().optional(),
  estimatedTokens: z.number().int().positive(),
  priority: z.enum(['high', 'normal', 'low']).optional(),
});

export const UsageReportRequestSchema = z.object({
  subscriptionId: z.string().min(1),
  sessionId: z.string().min(1),
  cost: z.number().nonnegative(),
  tokens: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    cacheCreationTokens: z.number().int().nonnegative(),
    cacheReadTokens: z.number().int().nonnegative(),
  }),
  durationMs: z.number().optional(),
  model: z.string().optional(),
});

// ============================================================================
// Validation Functions
// ============================================================================

export function validateSubscription(data: unknown) {
  return SubscriptionSchema.parse(data);
}

export function validateClientSession(data: unknown) {
  return ClientSessionSchema.parse(data);
}

export function validateUsageRecord(data: unknown) {
  return UsageRecordSchema.parse(data);
}

export function validateAllocationRequest(data: unknown) {
  return AllocationRequestSchema.parse(data);
}

export function validateUsageReportRequest(data: unknown) {
  return UsageReportRequestSchema.parse(data);
}
