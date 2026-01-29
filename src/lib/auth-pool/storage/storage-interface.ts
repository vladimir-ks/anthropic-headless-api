/**
 * Storage Interface
 *
 * Abstract storage layer for auth pool data.
 * Implementations: MemoryStore (development), DurableObjectStore (production)
 */

export interface StorageInterface {
  // ============================================================================
  // Key-Value Operations
  // ============================================================================

  /**
   * Get value by key
   * Returns null if key doesn't exist
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set value by key
   * Overwrites existing value if present
   */
  set<T>(key: string, value: T): Promise<void>;

  /**
   * Delete key
   * No-op if key doesn't exist
   */
  delete(key: string): Promise<void>;

  /**
   * List all keys matching a prefix
   * Returns empty array if no matches
   */
  list(prefix: string): Promise<string[]>;

  // ============================================================================
  // Batch Operations
  // ============================================================================

  /**
   * Get multiple values by keys
   * Returns Map with only existing keys (missing keys omitted)
   */
  getBatch<T>(keys: string[]): Promise<Map<string, T>>;

  /**
   * Set multiple key-value pairs
   * Atomic operation (all succeed or all fail)
   */
  setBatch<T>(entries: Map<string, T>): Promise<void>;

  // ============================================================================
  // Index Operations
  // ============================================================================

  /**
   * Add value to index (set-like structure)
   * Idempotent: adding same value twice has no effect
   */
  addToIndex(indexKey: string, value: string): Promise<void>;

  /**
   * Remove value from index
   * No-op if value not in index
   */
  removeFromIndex(indexKey: string, value: string): Promise<void>;

  /**
   * Get all values in index
   * Returns empty array if index doesn't exist
   */
  getIndex(indexKey: string): Promise<string[]>;

  // ============================================================================
  // Lifecycle
  // ============================================================================

  /**
   * Close storage connection
   * Should cleanup resources (e.g., file handles, network connections)
   */
  close(): Promise<void>;
}
