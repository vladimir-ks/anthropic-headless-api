/**
 * Auth Pool Client
 *
 * Client library for communicating with the auth pool service.
 * Used by anthropic-headless-api to allocate/deallocate subscriptions.
 */

import { createModuleLogger } from './auth-pool/utils/logger';
import type { AllocationBalancer } from './auth-pool/core/allocation-balancer';

const logger = createModuleLogger('AuthPoolClient');

export interface AllocationRequest {
  sessionId?: string;
  estimatedTokens: number;
  priority: 'high' | 'normal' | 'low';
}

export interface AllocationResult {
  type: 'subscription' | 'fallback';
  subscriptionId?: string;
  configDir?: string;
  reason: string;
}

export interface UsageReportData {
  subscriptionId: string;
  cost: number;
  tokens: number;
  sessionId?: string;
}

export interface HeartbeatData {
  clientId: string;
  subscriptionId: string;
  status: 'active' | 'idle';
  sessionCost?: number;
  sessionTokens?: number;
}

/**
 * Auth Pool Client
 * Communicates with in-process auth pool manager
 */
export class AuthPoolClient {
  private enabled: boolean;
  private allocator: AllocationBalancer | null = null;

  constructor(private config: { enabled: boolean }) {
    this.enabled = config.enabled;
  }

  /**
   * Inject the allocation balancer instance
   * Called during initialization
   */
  setAllocator(allocator: AllocationBalancer): void {
    this.allocator = allocator;
  }

  /**
   * Check if auth pool is enabled
   */
  isEnabled(): boolean {
    return this.enabled && this.allocator !== null;
  }

  /**
   * Allocate account for session
   */
  async allocateAccount(request: AllocationRequest): Promise<AllocationResult> {
    if (!this.isEnabled()) {
      return {
        type: 'fallback',
        reason: 'Auth pool disabled',
      };
    }

    try {
      // Generate client ID from session ID or crypto-secure random
      const clientId = request.sessionId || `client_${crypto.randomUUID()}`;

      const result = await this.allocator!.allocateSession({
        clientId,
        ...request,
      });

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Allocation failed', error instanceof Error ? error : new Error(errorMessage));
      return {
        type: 'fallback',
        reason: `Allocation error: ${errorMessage}`,
      };
    }
  }

  /**
   * Report usage after request completes
   */
  async reportUsage(data: UsageReportData): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      // This would be called after Claude CLI execution
      // Usage tracking happens automatically via UsageTracker
      logger.debug(`Usage reported: $${data.cost.toFixed(3)}`, { subscriptionId: data.subscriptionId });
    } catch (error) {
      logger.error('Usage report failed', error as Error);
    }
  }

  /**
   * Send heartbeat (for future use)
   */
  async sendHeartbeat(data: HeartbeatData): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      // Future: Update session activity status
      logger.debug('Heartbeat', { clientId: data.clientId, status: data.status });
    } catch (error) {
      logger.error('Heartbeat failed', error as Error);
    }
  }

  /**
   * Deallocate session
   */
  async deallocateSession(clientId: string): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    try {
      await this.allocator!.deallocateSession(clientId);
      logger.debug('Session deallocated', { clientId });
    } catch (error) {
      logger.error('Deallocation failed', error instanceof Error ? error : new Error(String(error)));
    }
  }
}
