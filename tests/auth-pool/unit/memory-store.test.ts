/**
 * MemoryStore Unit Tests
 *
 * Tests in-memory implementation of StorageInterface.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { MemoryStore } from '../../../src/lib/auth-pool/storage/memory-store';

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore();
  });

  describe('get() and set()', () => {
    test('should store and retrieve string values', async () => {
      await store.set('key1', 'value1');
      const result = await store.get<string>('key1');

      expect(result).toBe('value1');
    });

    test('should store and retrieve object values', async () => {
      const obj = { name: 'test', count: 42 };
      await store.set('key2', obj);
      const result = await store.get<typeof obj>('key2');

      expect(result).toEqual(obj);
    });

    test('should return null for non-existent key', async () => {
      const result = await store.get('nonexistent');
      expect(result).toBeNull();
    });

    test('should overwrite existing value', async () => {
      await store.set('key3', 'first');
      await store.set('key3', 'second');
      const result = await store.get<string>('key3');

      expect(result).toBe('second');
    });

    test('should handle null values', async () => {
      await store.set('key4', null);
      const result = await store.get('key4');

      expect(result).toBeNull();
    });

    test('should handle array values', async () => {
      const arr = [1, 2, 3];
      await store.set('key5', arr);
      const result = await store.get<number[]>('key5');

      expect(result).toEqual(arr);
    });
  });

  describe('delete()', () => {
    test('should delete existing key', async () => {
      await store.set('key1', 'value');
      await store.delete('key1');
      const result = await store.get('key1');

      expect(result).toBeNull();
    });

    test('should be no-op for non-existent key', async () => {
      // Should not throw
      await expect(store.delete('nonexistent')).resolves.toBeUndefined();
    });

    test('should handle multiple deletes of same key', async () => {
      await store.set('key1', 'value');
      await store.delete('key1');
      await store.delete('key1'); // Second delete

      const result = await store.get('key1');
      expect(result).toBeNull();
    });
  });

  describe('list()', () => {
    test('should return all keys with given prefix', async () => {
      await store.set('user:1', 'alice');
      await store.set('user:2', 'bob');
      await store.set('user:3', 'charlie');
      await store.set('post:1', 'post1');

      const keys = await store.list('user:');

      expect(keys).toHaveLength(3);
      expect(keys).toContain('user:1');
      expect(keys).toContain('user:2');
      expect(keys).toContain('user:3');
      expect(keys).not.toContain('post:1');
    });

    test('should return empty array if no matches', async () => {
      await store.set('key1', 'value1');

      const keys = await store.list('nomatch:');

      expect(keys).toEqual([]);
    });

    test('should return all keys when prefix is empty', async () => {
      await store.set('key1', 'v1');
      await store.set('key2', 'v2');

      const keys = await store.list('');

      expect(keys.length).toBeGreaterThanOrEqual(2);
    });

    test('should handle exact key match', async () => {
      await store.set('subscription:sub1', { id: 'sub1' });
      await store.set('subscription:sub1:detail', { extra: true });

      const keys = await store.list('subscription:sub1');

      expect(keys).toHaveLength(2);
    });
  });

  describe('getBatch()', () => {
    test('should get multiple values', async () => {
      await store.set('k1', 'v1');
      await store.set('k2', 'v2');
      await store.set('k3', 'v3');

      const result = await store.getBatch<string>(['k1', 'k2', 'k3']);

      expect(result.size).toBe(3);
      expect(result.get('k1')).toBe('v1');
      expect(result.get('k2')).toBe('v2');
      expect(result.get('k3')).toBe('v3');
    });

    test('should omit non-existent keys', async () => {
      await store.set('k1', 'v1');
      // k2 doesn't exist

      const result = await store.getBatch<string>(['k1', 'k2']);

      expect(result.size).toBe(1);
      expect(result.has('k1')).toBe(true);
      expect(result.has('k2')).toBe(false);
    });

    test('should handle empty key list', async () => {
      const result = await store.getBatch([]);

      expect(result.size).toBe(0);
    });
  });

  describe('setBatch()', () => {
    test('should set multiple key-value pairs', async () => {
      const entries = new Map<string, string>([
        ['k1', 'v1'],
        ['k2', 'v2'],
        ['k3', 'v3'],
      ]);

      await store.setBatch(entries);

      const v1 = await store.get<string>('k1');
      const v2 = await store.get<string>('k2');
      const v3 = await store.get<string>('k3');

      expect(v1).toBe('v1');
      expect(v2).toBe('v2');
      expect(v3).toBe('v3');
    });

    test('should handle empty map', async () => {
      const entries = new Map();
      await expect(store.setBatch(entries)).resolves.toBeUndefined();
    });

    test('should overwrite existing values', async () => {
      await store.set('k1', 'old');

      const entries = new Map([['k1', 'new']]);
      await store.setBatch(entries);

      const result = await store.get<string>('k1');
      expect(result).toBe('new');
    });
  });

  describe('Index operations', () => {
    describe('addToIndex()', () => {
      test('should add value to index', async () => {
        await store.addToIndex('sessions:sub1', 'ses1');

        const index = await store.getIndex('sessions:sub1');

        expect(index).toContain('ses1');
      });

      test('should be idempotent (adding twice has no effect)', async () => {
        await store.addToIndex('sessions:sub1', 'ses1');
        await store.addToIndex('sessions:sub1', 'ses1');

        const index = await store.getIndex('sessions:sub1');

        expect(index).toHaveLength(1);
        expect(index[0]).toBe('ses1');
      });

      test('should allow multiple values in same index', async () => {
        await store.addToIndex('sessions:sub1', 'ses1');
        await store.addToIndex('sessions:sub1', 'ses2');
        await store.addToIndex('sessions:sub1', 'ses3');

        const index = await store.getIndex('sessions:sub1');

        expect(index).toHaveLength(3);
        expect(index).toContain('ses1');
        expect(index).toContain('ses2');
        expect(index).toContain('ses3');
      });
    });

    describe('removeFromIndex()', () => {
      test('should remove value from index', async () => {
        await store.addToIndex('sessions:sub1', 'ses1');
        await store.addToIndex('sessions:sub1', 'ses2');
        await store.removeFromIndex('sessions:sub1', 'ses1');

        const index = await store.getIndex('sessions:sub1');

        expect(index).toHaveLength(1);
        expect(index).toContain('ses2');
        expect(index).not.toContain('ses1');
      });

      test('should be no-op if value not in index', async () => {
        await store.addToIndex('sessions:sub1', 'ses1');

        // Remove non-existent value
        await expect(
          store.removeFromIndex('sessions:sub1', 'ses2')
        ).resolves.toBeUndefined();

        const index = await store.getIndex('sessions:sub1');
        expect(index).toHaveLength(1);
      });

      test('should be no-op if index does not exist', async () => {
        await expect(
          store.removeFromIndex('nonexistent', 'value')
        ).resolves.toBeUndefined();
      });
    });

    describe('getIndex()', () => {
      test('should return all values in index', async () => {
        await store.addToIndex('idx', 'val1');
        await store.addToIndex('idx', 'val2');

        const index = await store.getIndex('idx');

        expect(index).toHaveLength(2);
      });

      test('should return empty array for non-existent index', async () => {
        const index = await store.getIndex('nonexistent');

        expect(index).toEqual([]);
      });

      test('should return empty array after all values removed', async () => {
        await store.addToIndex('idx', 'val1');
        await store.removeFromIndex('idx', 'val1');

        const index = await store.getIndex('idx');

        expect(index).toEqual([]);
      });
    });
  });

  describe('close()', () => {
    test('should close without errors', async () => {
      await store.set('key', 'value');

      await expect(store.close()).resolves.toBeUndefined();
    });

    test('should clear all data on close', async () => {
      await store.set('key', 'value');
      await store.close();

      // After close, data should be cleared
      const result = await store.get('key');
      expect(result).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle very long keys', async () => {
      const longKey = 'x'.repeat(1000);
      await store.set(longKey, 'value');

      const result = await store.get(longKey);
      expect(result).toBe('value');
    });

    test('should handle special characters in keys', async () => {
      const specialKey = 'key:with/special\\chars@#$%';
      await store.set(specialKey, 'value');

      const result = await store.get(specialKey);
      expect(result).toBe('value');
    });

    test('should handle large objects', async () => {
      const largeObj = {
        data: new Array(10000).fill({ id: 1, name: 'test' }),
      };

      await store.set('large', largeObj);
      const result = await store.get('large');

      expect(result).toEqual(largeObj);
    });

    test('should be isolated between instances', async () => {
      const store1 = new MemoryStore();
      const store2 = new MemoryStore();

      await store1.set('key', 'value1');
      await store2.set('key', 'value2');

      const result1 = await store1.get('key');
      const result2 = await store2.get('key');

      expect(result1).toBe('value1');
      expect(result2).toBe('value2');
    });
  });
});
