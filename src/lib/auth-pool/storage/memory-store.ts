/**
 * MemoryStore
 *
 * In-memory implementation of StorageInterface.
 * For development and testing. Does NOT persist data across restarts.
 */

import type { StorageInterface } from './storage-interface';

// Maximum entries to prevent unbounded memory growth
const MAX_DATA_ENTRIES = 100_000;
const MAX_INDEX_ENTRIES = 10_000;
const MAX_INDEX_VALUES = 10_000;

export class MemoryStore implements StorageInterface {
  private data: Map<string, unknown> = new Map();
  private indexes: Map<string, Set<string>> = new Map();

  // ============================================================================
  // Key-Value Operations
  // ============================================================================

  async get<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    return value !== undefined ? (value as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    // Prevent unbounded memory growth
    if (!this.data.has(key) && this.data.size >= MAX_DATA_ENTRIES) {
      // LRU eviction: remove oldest entry (first in map)
      const firstKey = this.data.keys().next().value;
      if (firstKey) {
        this.data.delete(firstKey);
      }
    }
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];

    for (const key of this.data.keys()) {
      if (key.startsWith(prefix)) {
        keys.push(key);
      }
    }

    return keys;
  }

  // ============================================================================
  // Batch Operations
  // ============================================================================

  async getBatch<T>(keys: string[]): Promise<Map<string, T>> {
    const result = new Map<string, T>();

    for (const key of keys) {
      const value = this.data.get(key);
      if (value !== undefined) {
        result.set(key, value as T);
      }
    }

    return result;
  }

  async setBatch<T>(entries: Map<string, T>): Promise<void> {
    for (const [key, value] of entries) {
      this.data.set(key, value);
    }
  }

  // ============================================================================
  // Index Operations
  // ============================================================================

  async addToIndex(indexKey: string, value: string): Promise<void> {
    let index = this.indexes.get(indexKey);

    if (!index) {
      // Prevent unbounded index growth
      if (this.indexes.size >= MAX_INDEX_ENTRIES) {
        // LRU eviction: remove oldest index
        const firstKey = this.indexes.keys().next().value;
        if (firstKey) {
          this.indexes.delete(firstKey);
        }
      }
      index = new Set<string>();
      this.indexes.set(indexKey, index);
    }

    // Prevent unbounded values per index
    if (!index.has(value) && index.size >= MAX_INDEX_VALUES) {
      // LRU eviction: remove oldest value
      const firstValue = index.values().next().value;
      if (firstValue) {
        index.delete(firstValue);
      }
    }

    index.add(value);
  }

  async removeFromIndex(indexKey: string, value: string): Promise<void> {
    const index = this.indexes.get(indexKey);

    if (index) {
      index.delete(value);

      // Clean up empty indexes
      if (index.size === 0) {
        this.indexes.delete(indexKey);
      }
    }
  }

  async getIndex(indexKey: string): Promise<string[]> {
    const index = this.indexes.get(indexKey);
    return index ? Array.from(index) : [];
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async close(): Promise<void> {
    // Clear all data
    this.data.clear();
    this.indexes.clear();
  }
}
