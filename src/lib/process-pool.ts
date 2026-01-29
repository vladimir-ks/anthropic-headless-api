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
  }

  /**
   * Execute a request through the process pool
   */
  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
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
}
