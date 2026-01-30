/**
 * Claude CLI Process Pool Manager
 *
 * Manages concurrent Claude CLI process execution with configurable limits.
 * Prevents resource exhaustion by queuing excess requests.
 */

import type { BackendAdapter } from './backends/base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types/api';

interface QueuedRequest {
  request: ChatCompletionRequest;
  resolve: (response: ChatCompletionResponse) => void;
  reject: (error: Error) => void;
  queuedAt: number;
}

// Maximum time a request can wait in queue before being rejected (30 seconds)
const QUEUE_TIMEOUT_MS = 30_000;

interface ProcessPoolStats {
  active: number;
  queued: number;
  maxConcurrent: number;
  maxQueue: number;
  utilization: number;
  totalProcessed: number;
  totalQueued: number;
  totalFailed: number;
}

export class ClaudeProcessPool {
  private activeCount: number = 0;
  private readonly maxConcurrent: number;
  private readonly maxQueue: number;
  private readonly queue: QueuedRequest[] = [];
  private processingNext: boolean = false; // Prevents race condition in processNext()
  private isShuttingDown: boolean = false;
  private queueCleanupInterval: ReturnType<typeof setInterval> | null = null;

  // Statistics
  private totalProcessed: number = 0;
  private totalQueued: number = 0;
  private totalFailed: number = 0;

  constructor(
    private backend: BackendAdapter,
    maxConcurrent: number = 10,
    maxQueue: number = 50
  ) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueue = maxQueue;

    // Start queue cleanup interval (every 5 seconds, check for stale items)
    this.queueCleanupInterval = setInterval(() => this.cleanupStaleQueueItems(), 5000);
  }

  /**
   * Remove stale queue items that have waited too long
   */
  private cleanupStaleQueueItems(): void {
    const now = Date.now();
    const staleItems: QueuedRequest[] = [];

    // Find and remove stale items
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const item = this.queue[i];
      if (now - item.queuedAt > QUEUE_TIMEOUT_MS) {
        staleItems.push(item);
        this.queue.splice(i, 1);
      }
    }

    // Reject stale items
    for (const item of staleItems) {
      this.totalFailed++;
      item.reject(new Error(`Request timed out in queue after ${QUEUE_TIMEOUT_MS}ms`));
    }
  }

  /**
   * Execute a request through the process pool
   */
  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Reject if shutting down
    if (this.isShuttingDown) {
      throw new Error('Process pool is shutting down');
    }

    // If under capacity, execute immediately
    if (this.activeCount < this.maxConcurrent) {
      return this.executeImmediate(request);
    }

    // Otherwise, try to queue
    if (this.queue.length < this.maxQueue) {
      return this.enqueue(request);
    }

    // Queue is full - reject request
    throw new Error(
      `Process pool queue full (${this.queue.length}/${this.maxQueue}). Try again later or use API fallback.`
    );
  }

  /**
   * Execute request immediately (internal use)
   */
  private async executeImmediate(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    this.activeCount++;
    this.totalProcessed++;

    try {
      const response = await this.backend.execute(request);
      return response;
    } finally {
      this.activeCount--;
      // Process next queued request if any
      this.processNext();
    }
  }

  /**
   * Enqueue a request to be processed when slot available
   */
  private async enqueue(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    this.totalQueued++;

    return new Promise<ChatCompletionResponse>((resolve, reject) => {
      this.queue.push({
        request,
        resolve,
        reject,
        queuedAt: Date.now(),
      });
    });
  }

  /**
   * Process the next queued request if slot available
   * Uses processingNext flag to prevent race condition when multiple
   * requests complete simultaneously and call this method
   */
  private processNext(): void {
    // Prevent re-entrant calls that could exceed maxConcurrent
    if (this.processingNext) {
      return;
    }

    this.processingNext = true;

    try {
      // Process all available slots
      while (this.activeCount < this.maxConcurrent && this.queue.length > 0) {
        const queued = this.queue.shift();
        if (!queued) break;

        // Execute the queued request
        this.executeImmediate(queued.request)
          .then(queued.resolve)
          .catch((error) => {
            this.totalFailed++;
            queued.reject(error);
          });
      }
    } finally {
      this.processingNext = false;
    }
  }

  /**
   * Get current pool statistics
   */
  getStats(): ProcessPoolStats {
    return {
      active: this.activeCount,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueue,
      utilization: this.activeCount / this.maxConcurrent,
      totalProcessed: this.totalProcessed,
      totalQueued: this.totalQueued,
      totalFailed: this.totalFailed,
    };
  }

  /**
   * Get backend name
   */
  getBackendName(): string {
    return this.backend.name;
  }

  /**
   * Gracefully shutdown the pool
   * Rejects all queued requests and waits for active requests to complete
   */
  async shutdown(timeoutMs: number = 30000): Promise<{ rejected: number; timedOut: boolean }> {
    this.isShuttingDown = true;

    // Stop queue cleanup interval
    if (this.queueCleanupInterval) {
      clearInterval(this.queueCleanupInterval);
      this.queueCleanupInterval = null;
    }

    // Reject all queued requests
    const rejected = this.queue.length;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) {
        item.reject(new Error('Process pool is shutting down'));
      }
    }

    // Wait for active requests to complete (with timeout)
    const startTime = Date.now();
    while (this.activeCount > 0 && (Date.now() - startTime) < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return {
      rejected,
      timedOut: this.activeCount > 0,
    };
  }
}

/**
 * Process Pool Registry
 *
 * Manages multiple process pools (one per Claude CLI backend)
 */
export class ProcessPoolRegistry {
  private pools: Map<string, ClaudeProcessPool> = new Map();

  /**
   * Register a Claude CLI backend with process pool limits
   */
  registerBackend(
    backend: BackendAdapter,
    maxConcurrent: number,
    maxQueue: number
  ): void {
    if (!backend.supportsTools || backend.type !== 'claude-cli') {
      throw new Error(`Only Claude CLI backends can be registered in process pool`);
    }

    const pool = new ClaudeProcessPool(backend, maxConcurrent, maxQueue);
    this.pools.set(backend.name, pool);
    console.log(
      `[ProcessPool] Registered ${backend.name} (max: ${maxConcurrent}, queue: ${maxQueue})`
    );
  }

  /**
   * Get process pool for a backend
   */
  getPool(backendName: string): ClaudeProcessPool | undefined {
    return this.pools.get(backendName);
  }

  /**
   * Execute request through appropriate process pool
   */
  async execute(
    backendName: string,
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const pool = this.pools.get(backendName);
    if (!pool) {
      throw new Error(`No process pool registered for backend: ${backendName}`);
    }

    return pool.execute(request);
  }

  /**
   * Get statistics for all pools
   */
  getAllStats(): Map<string, ProcessPoolStats> {
    const stats = new Map<string, ProcessPoolStats>();
    for (const [name, pool] of this.pools.entries()) {
      stats.set(name, pool.getStats());
    }
    return stats;
  }

  /**
   * Get total stats across all pools
   */
  getTotalStats(): ProcessPoolStats {
    const allStats = Array.from(this.pools.values()).map((p) => p.getStats());

    return {
      active: allStats.reduce((sum, s) => sum + s.active, 0),
      queued: allStats.reduce((sum, s) => sum + s.queued, 0),
      maxConcurrent: allStats.reduce((sum, s) => sum + s.maxConcurrent, 0),
      maxQueue: allStats.reduce((sum, s) => sum + s.maxQueue, 0),
      utilization: allStats.length > 0
        ? allStats.reduce((sum, s) => sum + s.utilization, 0) / allStats.length
        : 0,
      totalProcessed: allStats.reduce((sum, s) => sum + s.totalProcessed, 0),
      totalQueued: allStats.reduce((sum, s) => sum + s.totalQueued, 0),
      totalFailed: allStats.reduce((sum, s) => sum + s.totalFailed, 0),
    };
  }

  /**
   * Gracefully shutdown all pools
   */
  async shutdown(timeoutMs: number = 30000): Promise<{ totalRejected: number; anyTimedOut: boolean }> {
    const results = await Promise.all(
      Array.from(this.pools.values()).map((pool) => pool.shutdown(timeoutMs))
    );

    return {
      totalRejected: results.reduce((sum, r) => sum + r.rejected, 0),
      anyTimedOut: results.some((r) => r.timedOut),
    };
  }
}
