/**
 * Session Store Unit Tests
 *
 * Tests client session management (session → subscription mapping).
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { SessionStore } from '../../../src/lib/auth-pool/core/session-store';
import { MemoryStore } from '../../../src/lib/auth-pool/storage/memory-store';

describe('SessionStore', () => {
  let store: SessionStore;
  let storage: MemoryStore;

  beforeEach(() => {
    storage = new MemoryStore();
    store = new SessionStore(storage);
  });

  describe('createSession()', () => {
    test('should create new client session', async () => {
      const session = await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
        clientIp: '192.168.1.1',
        userAgent: 'Claude-Code/1.0',
      });

      expect(session.id).toBe('client1');
      expect(session.subscriptionId).toBe('sub1');
      expect(session.status).toBe('active');
      expect(session.sessionCost).toBe(0);
      expect(session.sessionTokens).toBe(0);
      expect(session.requestCount).toBe(0);
    });

    test('should store session in storage', async () => {
      const session = await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });

      const stored = await storage.get(`session:client1`);
      expect(stored).toEqual(session);
    });

    test('should throw if session already exists', async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });

      await expect(
        store.createSession({
          clientId: 'client1',
          subscriptionId: 'sub2',
        })
      ).rejects.toThrow('Session already exists');
    });

    test('should add session to subscription index', async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });

      const index = await storage.getIndex('index:sessions_by_subscription:sub1');
      expect(index).toContain('client1');
    });
  });

  describe('getSession()', () => {
    beforeEach(async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });
    });

    test('should retrieve session by ID', async () => {
      const session = await store.getSession('client1');

      expect(session).not.toBeNull();
      expect(session?.id).toBe('client1');
    });

    test('should return null if session not found', async () => {
      const session = await store.getSession('nonexistent');

      expect(session).toBeNull();
    });

    test('should use cache on subsequent calls', async () => {
      // First call - loads from storage
      await store.getSession('client1');

      // Manually modify storage
      await storage.set('session:client1', { id: 'modified' });

      // Second call - should return cached value
      const session = await store.getSession('client1');

      expect(session?.subscriptionId).toBe('sub1'); // Original value
    });
  });

  describe('updateSession()', () => {
    beforeEach(async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });
    });

    test('should update session fields', async () => {
      await store.updateSession('client1', {
        sessionCost: 10.5,
        sessionTokens: 50000,
        requestCount: 5,
        status: 'idle',
      });

      const session = await store.getSession('client1');

      expect(session?.sessionCost).toBe(10.5);
      expect(session?.sessionTokens).toBe(50000);
      expect(session?.requestCount).toBe(5);
      expect(session?.status).toBe('idle');
    });

    test('should update lastActivity timestamp', async () => {
      const before = Date.now();

      await store.updateSession('client1', {
        sessionCost: 5,
      });

      const session = await store.getSession('client1');

      expect(session?.lastActivity).toBeGreaterThanOrEqual(before);
    });

    test('should persist to storage', async () => {
      await store.updateSession('client1', { sessionCost: 20 });

      const stored = await storage.get('session:client1');
      expect(stored.sessionCost).toBe(20);
    });

    test('should throw if session not found', async () => {
      await expect(
        store.updateSession('nonexistent', { sessionCost: 10 })
      ).rejects.toThrow('Session not found');
    });
  });

  describe('deleteSession()', () => {
    beforeEach(async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });
    });

    test('should remove session from storage', async () => {
      await store.deleteSession('client1');

      const session = await storage.get('session:client1');
      expect(session).toBeNull();
    });

    test('should remove from cache', async () => {
      // Load into cache
      await store.getSession('client1');

      // Delete
      await store.deleteSession('client1');

      // Should not be in cache
      const session = await store.getSession('client1');
      expect(session).toBeNull();
    });

    test('should remove from subscription index', async () => {
      await store.deleteSession('client1');

      const index = await storage.getIndex('index:sessions_by_subscription:sub1');
      expect(index).not.toContain('client1');
    });

    test('should not throw if session does not exist', async () => {
      await expect(
        store.deleteSession('nonexistent')
      ).resolves.toBeUndefined();
    });
  });

  describe('getSessionsBySubscription()', () => {
    beforeEach(async () => {
      await store.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await store.createSession({ clientId: 'client2', subscriptionId: 'sub1' });
      await store.createSession({ clientId: 'client3', subscriptionId: 'sub2' });
    });

    test('should return all sessions for a subscription', async () => {
      const sessions = await store.getSessionsBySubscription('sub1');

      expect(sessions).toHaveLength(2);
      expect(sessions.map(s => s.id)).toContain('client1');
      expect(sessions.map(s => s.id)).toContain('client2');
    });

    test('should return empty array if no sessions', async () => {
      const sessions = await store.getSessionsBySubscription('sub_empty');

      expect(sessions).toEqual([]);
    });

    test('should not include sessions from other subscriptions', async () => {
      const sessions = await store.getSessionsBySubscription('sub1');

      expect(sessions.map(s => s.id)).not.toContain('client3');
    });
  });

  describe('markStale()', () => {
    beforeEach(async () => {
      await store.createSession({ clientId: 'client1', subscriptionId: 'sub1' });
      await store.createSession({ clientId: 'client2', subscriptionId: 'sub1' });
    });

    test('should mark idle sessions as stale', async () => {
      const now = Date.now();
      const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

      // Create old idle session
      await store.updateSession('client1', {
        status: 'idle',
      });

      // Manually set lastActivity to old timestamp
      const session = await storage.get('session:client1');
      session.lastActivity = now - STALE_THRESHOLD - 1000; // 6 minutes ago
      await storage.set('session:client1', session);

      // Mark stale
      const count = await store.markStale(STALE_THRESHOLD);

      expect(count).toBe(1);

      const updated = await store.getSession('client1');
      expect(updated?.status).toBe('stale');
    });

    test('should not mark active sessions as stale', async () => {
      await store.updateSession('client1', { status: 'active' });

      const count = await store.markStale(5 * 60 * 1000);

      expect(count).toBe(0);

      const session = await store.getSession('client1');
      expect(session?.status).toBe('active');
    });

    test('should not mark recent sessions as stale', async () => {
      await store.updateSession('client1', { status: 'idle' });

      const count = await store.markStale(5 * 60 * 1000);

      expect(count).toBe(0);

      const session = await store.getSession('client1');
      expect(session?.status).toBe('idle');
    });
  });

  describe('reassignSession()', () => {
    beforeEach(async () => {
      await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
      });
    });

    test('should move session to new subscription', async () => {
      await store.reassignSession('client1', 'sub2');

      const session = await store.getSession('client1');
      expect(session?.subscriptionId).toBe('sub2');
    });

    test('should update subscription indexes', async () => {
      await store.reassignSession('client1', 'sub2');

      // Old subscription index should not contain client
      const oldIndex = await storage.getIndex('index:sessions_by_subscription:sub1');
      expect(oldIndex).not.toContain('client1');

      // New subscription index should contain client
      const newIndex = await storage.getIndex('index:sessions_by_subscription:sub2');
      expect(newIndex).toContain('client1');
    });

    test('should reset session usage counters', async () => {
      await store.updateSession('client1', {
        sessionCost: 10,
        sessionTokens: 50000,
        requestCount: 5,
      });

      await store.reassignSession('client1', 'sub2');

      const session = await store.getSession('client1');
      expect(session?.sessionCost).toBe(0);
      expect(session?.sessionTokens).toBe(0);
      expect(session?.requestCount).toBe(0);
    });

    test('should update allocatedAt timestamp', async () => {
      const before = Date.now();

      await store.reassignSession('client1', 'sub2');

      const session = await store.getSession('client1');
      expect(session?.allocatedAt).toBeGreaterThanOrEqual(before);
    });

    test('should throw if session not found', async () => {
      await expect(
        store.reassignSession('nonexistent', 'sub2')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('edge cases', () => {
    test('should handle concurrent session creation', async () => {
      await Promise.all([
        store.createSession({ clientId: 'client1', subscriptionId: 'sub1' }),
        store.createSession({ clientId: 'client2', subscriptionId: 'sub1' }),
        store.createSession({ clientId: 'client3', subscriptionId: 'sub2' }),
      ]);

      const sessions = await store.getSessionsBySubscription('sub1');
      expect(sessions).toHaveLength(2);
    });

    test('should handle session update race conditions', async () => {
      await store.createSession({ clientId: 'client1', subscriptionId: 'sub1' });

      // Concurrent updates
      await Promise.all([
        store.updateSession('client1', { sessionCost: 10 }),
        store.updateSession('client1', { sessionTokens: 50000 }),
      ]);

      const session = await store.getSession('client1');

      // One of the updates should have succeeded
      expect(session?.sessionCost === 10 || session?.sessionTokens === 50000).toBe(true);
    });

    test('should handle missing optional fields', async () => {
      const session = await store.createSession({
        clientId: 'client1',
        subscriptionId: 'sub1',
        // No clientIp or userAgent
      });

      expect(session.clientIp).toBeUndefined();
      expect(session.userAgent).toBeUndefined();
    });
  });
});
