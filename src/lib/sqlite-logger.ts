/**
 * SQLite Request Logger
 *
 * Logs all requests and responses to SQLite database for:
 * - Observability and debugging
 * - Cost tracking and analytics
 * - Training data collection
 * - Performance monitoring
 */

import { Database } from 'bun:sqlite';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../types/api';
import type { RoutingDecision } from './router';

interface LogEntry {
  id: string;
  timestamp: number;
  backend: string;
  backendType: 'claude-cli' | 'api';
  instance?: string;
  workingDirectory?: string;
  model?: string;
  sessionId?: string;
  prompt: string;
  response?: string;
  error?: string;
  durationMs: number;
  tokensInput?: number;
  tokensOutput?: number;
  costUsd?: number;
  queueWaitMs?: number;
  degraded: boolean;
  metadata?: Record<string, unknown>;
}

export class SQLiteLogger {
  private db: Database | null = null;
  private enabled: boolean;

  constructor(databasePath: string, enabled: boolean = true) {
    this.enabled = enabled;

    if (!enabled) {
      console.log('[SQLiteLogger] Logging disabled');
      return;
    }

    // Open database
    this.db = new Database(databasePath);

    // Run migrations
    this.runMigrations();

    console.log(`[SQLiteLogger] Initialized at ${databasePath}`);
  }

  /**
   * Run database migrations
   */
  private runMigrations(): void {
    if (!this.db) return;

    try {
      const migrationPath = resolve(__dirname, '../../migrations/001_create_requests_table.sql');

      // Validate migration path is within project directory
      const projectRoot = resolve(__dirname, '../..');
      if (!migrationPath.startsWith(projectRoot)) {
        throw new Error('Migration path escapes project directory');
      }

      const migration = readFileSync(migrationPath, 'utf-8');
      this.db.exec(migration);
      console.log('[SQLiteLogger] Migrations applied successfully');
    } catch (error) {
      console.error('[SQLiteLogger] Migration failed:', error);
      throw error;
    }
  }

  /**
   * Log a request/response pair
   */
  async log(
    request: ChatCompletionRequest,
    response: ChatCompletionResponse | null,
    decision: RoutingDecision,
    durationMs: number,
    queueWaitMs?: number,
    error?: string
  ): Promise<void> {
    if (!this.enabled || !this.db) return;

    try {
      // Extract prompt from messages
      const prompt = request.messages
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');

      // Extract response content
      const responseContent = response?.choices[0]?.message?.content || null;

      // Build metadata
      const metadata = {
        requestId: response?.id,
        model: response?.model,
        finishReason: response?.choices[0]?.finish_reason,
        routingReason: decision.reason,
      };

      const entry: LogEntry = {
        id: response?.id || `req-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        backend: decision.backend.name,
        backendType: decision.backend.type,
        instance: request.session_id,
        workingDirectory: request.working_directory,
        model: request.model || response?.model,
        sessionId: response?.session_id || request.session_id,
        prompt,
        response: responseContent || undefined,
        error,
        durationMs,
        tokensInput: response?.usage?.prompt_tokens,
        tokensOutput: response?.usage?.completion_tokens,
        costUsd: decision.estimatedCost,
        queueWaitMs,
        degraded: decision.isFallback,
        metadata,
      };

      // Insert into database
      const stmt = this.db.prepare(`
        INSERT INTO requests (
          id, timestamp, backend, backend_type, instance,
          working_directory, model, session_id, prompt, response,
          error, duration_ms, tokens_input, tokens_output, cost_usd,
          queue_wait_ms, degraded, metadata
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?
        )
      `);

      stmt.run(
        entry.id,
        entry.timestamp,
        entry.backend,
        entry.backendType,
        entry.instance || null,
        entry.workingDirectory || null,
        entry.model || null,
        entry.sessionId || null,
        entry.prompt,
        entry.response || null,
        entry.error || null,
        entry.durationMs,
        entry.tokensInput || null,
        entry.tokensOutput || null,
        entry.costUsd || null,
        entry.queueWaitMs || null,
        entry.degraded ? 1 : 0,
        JSON.stringify(entry.metadata)
      );
    } catch (error) {
      console.error('[SQLiteLogger] Failed to log request:', error);
      // Don't throw - logging failures shouldn't break the request
    }
  }

  /**
   * Query recent requests
   */
  getRecentRequests(limit: number = 100): Array<Record<string, unknown>> {
    if (!this.enabled || !this.db) return [];

    try {
      const stmt = this.db.prepare(`
        SELECT * FROM requests
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      return stmt.all(limit) as Array<Record<string, unknown>>;
    } catch (error) {
      console.error('[SQLiteLogger] Failed to query requests:', error);
      return [];
    }
  }

  /**
   * Get request statistics
   */
  getStats(): Record<string, unknown> {
    if (!this.enabled || !this.db) return {};

    try {
      // Total requests
      const total = this.db
        .prepare('SELECT COUNT(*) as count FROM requests')
        .get() as { count: number };

      // By backend
      const byBackend = this.db
        .prepare('SELECT backend, COUNT(*) as count FROM requests GROUP BY backend')
        .all();

      // By backend type
      const byType = this.db
        .prepare('SELECT backend_type, COUNT(*) as count FROM requests GROUP BY backend_type')
        .all();

      // Degraded requests
      const degraded = this.db
        .prepare('SELECT COUNT(*) as count FROM requests WHERE degraded = 1')
        .get() as { count: number };

      // Errors
      const errors = this.db
        .prepare('SELECT COUNT(*) as count FROM requests WHERE error IS NOT NULL')
        .get() as { count: number };

      // Average duration
      const avgDuration = this.db
        .prepare('SELECT AVG(duration_ms) as avg FROM requests')
        .get() as { avg: number };

      // Total cost
      const totalCost = this.db
        .prepare('SELECT SUM(cost_usd) as sum FROM requests')
        .get() as { sum: number };

      return {
        total: total.count,
        byBackend,
        byType,
        degraded: degraded.count,
        errors: errors.count,
        avgDurationMs: avgDuration.avg,
        totalCostUsd: totalCost.sum,
      };
    } catch (error) {
      console.error('[SQLiteLogger] Failed to get stats:', error);
      return {};
    }
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
    }
  }
}
