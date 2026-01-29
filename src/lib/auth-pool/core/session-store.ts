/**
 * Session Store
 *
 * Manages client sessions (session → subscription mapping).
 * Based on PSEUDOCODE.md specification.
 */

import type { StorageInterface } from '../storage/storage-interface';
import type { ClientSession } from '../types';
import { validateClientSession } from '../utils/validators';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('SessionStore');

interface CreateSessionInput {
  clientId: string;
  subscriptionId: string;
  clientIp?: string;
  userAgent?: string;
}

export class SessionStore {
  private cache: Map<string, ClientSession> = new Map();
  private readonly maxCacheSize: number = 1000; // Prevent unbounded growth

  constructor(private storage: StorageInterface) {}

  /**
   * Create new client session
   * Throws if session already exists
   */
  async createSession(input: CreateSessionInput): Promise<ClientSession> {
    // Check if session already exists
    const existing = await this.storage.get<ClientSession>(`session:${input.clientId}`);

    if (existing) {
      throw new Error(`Session already exists: ${input.clientId}`);
    }

    const now = Date.now();

    const session: ClientSession = {
      id: input.clientId,
      subscriptionId: input.subscriptionId,
      allocatedAt: now,
      lastActivity: now,
      status: 'active',
      sessionCost: 0,
      sessionTokens: 0,
      requestCount: 0,
      clientIp: input.clientIp,
      userAgent: input.userAgent,
    };

    // Validate
    const validated = validateClientSession(session);

    // Store session
    await this.storage.set(`session:${input.clientId}`, validated);

    // Add to subscription index
    await this.storage.addToIndex(
      `index:sessions_by_subscription:${input.subscriptionId}`,
      input.clientId
    );

    // Cache
    this.cache.set(input.clientId, validated);
    this.evictOldestIfNeeded();

    logger.debug('Created session', {
      clientId: input.clientId,
      subscriptionId: input.subscriptionId,
    });

    return validated;
  }

  /**
   * Get session by ID
   * Uses cache first, falls back to storage
   */
  async getSession(clientId: string): Promise<ClientSession | null> {
    // Check cache first
    if (this.cache.has(clientId)) {
      return this.cache.get(clientId) ?? null;
    }

    // Cache miss - load from storage
    const session = await this.storage.get<ClientSession>(`session:${clientId}`);

    if (session) {
      this.cache.set(clientId, session);
      this.evictOldestIfNeeded();
    }

    return session;
  }

  /**
   * Update session fields
   * Automatically updates lastActivity timestamp
   */
  async updateSession(clientId: string, updates: Partial<ClientSession>): Promise<void> {
    const session = await this.getSession(clientId);

    if (!session) {
      throw new Error(`Session not found: ${clientId}`);
    }

    // Merge updates
    const updated = {
      ...session,
      ...updates,
      lastActivity: Date.now(), // Always update lastActivity
    };

    // Validate
    const validated = validateClientSession(updated);

    // Persist
    await this.storage.set(`session:${clientId}`, validated);

    // Update cache
    this.cache.set(clientId, validated);
    this.evictOldestIfNeeded();
  }

  /**
   * Delete session
   * Removes from storage, cache, and subscription index
   */
  async deleteSession(clientId: string): Promise<void> {
    const session = await this.getSession(clientId);

    if (!session) {
      // Session doesn't exist - no-op
      return;
    }

    // Remove from storage
    await this.storage.delete(`session:${clientId}`);

    // Remove from subscription index
    await this.storage.removeFromIndex(
      `index:sessions_by_subscription:${session.subscriptionId}`,
      clientId
    );

    // Remove from cache
    this.cache.delete(clientId);

    logger.debug('Deleted session', { clientId });
  }

  /**
   * Get all sessions for a subscription
   */
  async getSessionsBySubscription(subscriptionId: string): Promise<ClientSession[]> {
    const index = await this.storage.getIndex(`index:sessions_by_subscription:${subscriptionId}`);

    const sessions: ClientSession[] = [];

    for (const clientId of index) {
      const session = await this.getSession(clientId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Mark idle sessions as stale
   * Returns count of marked sessions
   */
  async markStale(staleThresholdMs: number): Promise<number> {
    const now = Date.now();
    const cutoff = now - staleThresholdMs;

    let count = 0;

    // Get all sessions
    const prefix = 'session:';
    const allKeys = await this.storage.list(prefix);

    for (const key of allKeys) {
      const session = await this.storage.get<ClientSession>(key);

      if (!session) {
        continue;
      }

      // Only mark idle sessions as stale
      if (session.status !== 'idle') {
        continue;
      }

      // Check if stale
      if (session.lastActivity < cutoff) {
        await this.updateSession(session.id, { status: 'stale' });
        count++;
      }
    }

    if (count > 0) {
      logger.info(`Marked ${count} sessions as stale`);
    }

    return count;
  }

  /**
   * Reassign session to new subscription
   * Resets usage counters and updates indexes
   */
  async reassignSession(clientId: string, newSubscriptionId: string): Promise<void> {
    const session = await this.getSession(clientId);

    if (!session) {
      throw new Error(`Session not found: ${clientId}`);
    }

    const oldSubscriptionId = session.subscriptionId;

    // Remove from old subscription index
    await this.storage.removeFromIndex(
      `index:sessions_by_subscription:${oldSubscriptionId}`,
      clientId
    );

    // Add to new subscription index
    await this.storage.addToIndex(
      `index:sessions_by_subscription:${newSubscriptionId}`,
      clientId
    );

    // Update session
    await this.updateSession(clientId, {
      subscriptionId: newSubscriptionId,
      allocatedAt: Date.now(),
      // Reset usage counters
      sessionCost: 0,
      sessionTokens: 0,
      requestCount: 0,
    });

    logger.info('Reassigned session', {
      clientId,
      fromSubscription: oldSubscriptionId,
      toSubscription: newSubscriptionId,
    });
  }

  /**
   * Evict oldest cache entries if cache exceeds maxCacheSize
   * Uses Map insertion order (FIFO eviction)
   */
  private evictOldestIfNeeded(): void {
    if (this.cache.size <= this.maxCacheSize) {
      return;
    }

    // Evict oldest 10% when limit exceeded
    const evictCount = Math.ceil(this.maxCacheSize * 0.1);
    const keysToEvict = Array.from(this.cache.keys()).slice(0, evictCount);

    for (const key of keysToEvict) {
      this.cache.delete(key);
    }

    logger.debug('Cache eviction', {
      evicted: evictCount,
      remaining: this.cache.size,
    });
  }
}
