/**
 * MemoryStore
 *
 * In-memory implementation of StorageInterface.
 * For development and testing. Does NOT persist data across restarts.
 */

import type { StorageInterface } from './storage-interface';

export class MemoryStore implements StorageInterface {
  private data: Map<string, any> = new Map();
  private indexes: Map<string, Set<string>> = new Map();

  // ============================================================================
  // Key-Value Operations
  // ============================================================================

  async get<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    return value !== undefined ? value : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
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
        result.set(key, value);
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
      index = new Set<string>();
      this.indexes.set(indexKey, index);
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
