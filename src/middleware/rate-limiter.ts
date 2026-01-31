/**
 * Rate Limiter Middleware
 *
 * Protects against accidental request floods from code errors.
 * Uses sliding window algorithm for smooth rate limiting.
 *
 * PROTECTION GOALS:
 * - Prevent accidental token exhaustion from buggy client code
 * - Protect against infinite loops in client applications
 * - Allow legitimate burst traffic while preventing abuse
 */

import type { RateLimitConfig } from '../types/api';

interface RateLimitEntry {
  timestamps: number[];
  blocked: boolean;
  blockedUntil?: number;
}

export class RateLimiter {
  private entries = new Map<string, RateLimitEntry>();
  private config: Required<RateLimitConfig>;
  private cleanupRunning = false;

  /** Maximum number of tracked clients before LRU eviction (prevents unbounded growth) */
  private static readonly MAX_ENTRIES = 10000;

  /** Cleanup interval handle */
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests ?? 60,
      windowMs: config.windowMs ?? 60_000, // 1 minute default
      enabled: config.enabled ?? true,
    };

    // Start periodic cleanup of old entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Check if a request is allowed
   * @param key - Identifier for the client (IP, API key, etc.)
   * @returns Object with allowed status and metadata
   */
  check(key: string): RateLimitResult {
    if (!this.config.enabled) {
      return {
        allowed: true,
        remaining: this.config.maxRequests,
        resetAt: Date.now() + this.config.windowMs,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    // Get or create entry
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { timestamps: [], blocked: false };
      this.entries.set(key, entry);
    }

    // Check if currently blocked
    if (entry.blocked && entry.blockedUntil && now < entry.blockedUntil) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.blockedUntil,
        retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
        reason: 'rate_limited',
      };
    }

    // Clear block if expired
    if (entry.blocked && entry.blockedUntil && now >= entry.blockedUntil) {
      entry.blocked = false;
      entry.blockedUntil = undefined;
    }

    // Filter to only timestamps within window
    entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

    // Check if limit exceeded
    if (entry.timestamps.length >= this.config.maxRequests) {
      // Block for remainder of window
      // Guard against empty array (defensive - shouldn't happen since length >= maxRequests > 0)
      const oldestInWindow = entry.timestamps.length > 0
        ? Math.min(...entry.timestamps)
        : now;
      entry.blocked = true;
      entry.blockedUntil = oldestInWindow + this.config.windowMs;

      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.blockedUntil,
        retryAfter: Math.ceil((entry.blockedUntil - now) / 1000),
        reason: 'rate_limited',
      };
    }

    // Add current timestamp
    entry.timestamps.push(now);

    // Calculate remaining
    const remaining = this.config.maxRequests - entry.timestamps.length;
    const resetAt =
      entry.timestamps.length > 0
        ? Math.min(...entry.timestamps) + this.config.windowMs
        : now + this.config.windowMs;

    return {
      allowed: true,
      remaining,
      resetAt,
    };
  }

  /**
   * Get current status for a key
   * Returns a defensive copy to prevent mutation of internal state
   */
  getStatus(key: string): RateLimitStatus {
    const entry = this.entries.get(key);
    if (!entry) {
      return {
        requests: 0,
        remaining: this.config.maxRequests,
        blocked: false,
      };
    }

    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    // filter() creates a new array, preventing mutation of internal timestamps
    const activeTimestamps = entry.timestamps.filter((t) => t > windowStart);

    return {
      requests: activeTimestamps.length,
      remaining: Math.max(0, this.config.maxRequests - activeTimestamps.length),
      blocked: entry.blocked && (entry.blockedUntil ?? 0) > now,
      blockedUntil: entry.blockedUntil,
    };
  }

  /**
   * Clean up old entries to prevent memory growth
   * Prevents concurrent cleanup to avoid race conditions
   * Implements LRU eviction if entry count exceeds MAX_ENTRIES
   */
  private cleanup(): void {
    // Prevent concurrent cleanup runs
    if (this.cleanupRunning) return;
    this.cleanupRunning = true;

    try {
      const now = Date.now();
      const windowStart = now - this.config.windowMs;

      // Create snapshot of keys to avoid modification during iteration
      const keysToDelete: string[] = [];

      for (const [key, entry] of this.entries) {
        // Remove timestamps outside window
        entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

        // Mark entry for deletion if empty and not blocked
        if (entry.timestamps.length === 0 && !entry.blocked) {
          keysToDelete.push(key);
        }

        // Clear expired blocks
        if (entry.blocked && entry.blockedUntil && now >= entry.blockedUntil) {
          entry.blocked = false;
          entry.blockedUntil = undefined;
        }
      }

      // Delete entries after iteration
      for (const key of keysToDelete) {
        this.entries.delete(key);
      }

      // LRU eviction: if still over limit, remove oldest inactive entries
      // Uses partial sort (O(n) average) instead of full sort (O(n log n))
      if (this.entries.size > RateLimiter.MAX_ENTRIES) {
        const entriesToEvict = this.entries.size - RateLimiter.MAX_ENTRIES;
        const entriesWithActivity = Array.from(this.entries.entries())
          .map(([key, entry]) => ({
            key,
            lastActivity: entry.timestamps[entry.timestamps.length - 1] || 0,
          }));

        // Partial sort: find k smallest using quickselect-like approach
        // For small k, this is O(n) average vs O(n log n) for full sort
        if (entriesToEvict < entriesWithActivity.length / 4) {
          // For small eviction counts, find k smallest iteratively
          for (let i = 0; i < entriesToEvict; i++) {
            let minIdx = i;
            for (let j = i + 1; j < entriesWithActivity.length; j++) {
              if (entriesWithActivity[j].lastActivity < entriesWithActivity[minIdx].lastActivity) {
                minIdx = j;
              }
            }
            // Swap
            [entriesWithActivity[i], entriesWithActivity[minIdx]] =
              [entriesWithActivity[minIdx], entriesWithActivity[i]];
            this.entries.delete(entriesWithActivity[i].key);
          }
        } else {
          // For large eviction counts, full sort is more efficient
          entriesWithActivity.sort((a, b) => a.lastActivity - b.lastActivity);
          for (let i = 0; i < entriesToEvict; i++) {
            this.entries.delete(entriesWithActivity[i].key);
          }
        }
      }
    } finally {
      this.cleanupRunning = false;
    }
  }

  /**
   * Stop the rate limiter (cleanup interval)
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Reset rate limit for a key (admin use)
   */
  reset(key: string): void {
    this.entries.delete(key);
  }

  /**
   * Get configuration
   */
  getConfig(): Required<RateLimitConfig> {
    return { ...this.config };
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // Unix timestamp in ms
  retryAfter?: number; // Seconds until retry allowed
  reason?: 'rate_limited';
}

export interface RateLimitStatus {
  requests: number;
  remaining: number;
  blocked: boolean;
  blockedUntil?: number;
}

/**
 * Create default rate limiter with sensible defaults
 *
 * Defaults:
 * - 60 requests per minute (1 per second average)
 * - Allows burst of 60 requests
 * - Blocks for remainder of window if exceeded
 */
export function createDefaultRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 60,
    windowMs: 60_000,
    enabled: true,
  });
}

/** Maximum length for IP address in rate limit key (IPv6 max = 45 chars) */
const MAX_IP_LENGTH = 45;

/** Maximum length for API key/token in rate limit key */
const MAX_KEY_LENGTH = 20;

/** IPv4/IPv6 validation regex (loose validation for performance) */
const IP_PATTERN = /^[\da-fA-F.:]+$/;

/**
 * Sanitize and validate an IP address for use in rate limit keys
 * Returns null if invalid
 */
function sanitizeIp(ip: string | undefined): string | null {
  if (!ip) return null;

  // Trim and limit length to prevent memory bloat
  const trimmed = ip.trim().substring(0, MAX_IP_LENGTH);

  // Basic format validation (alphanumeric, dots, colons only)
  if (!IP_PATTERN.test(trimmed)) {
    return null;
  }

  return trimmed;
}

/**
 * Extract rate limit key from request
 *
 * Priority:
 * 1. X-API-Key header
 * 2. Authorization Bearer token (first 20 chars)
 * 3. X-Forwarded-For header (first IP, validated)
 * 4. Remote IP
 * 5. "anonymous" fallback
 */
export function getRateLimitKey(req: Request, remoteIp?: string): string {
  // Check for API key header
  const apiKey = req.headers.get('X-API-Key');
  if (apiKey) {
    return `apikey:${apiKey.substring(0, MAX_KEY_LENGTH)}`;
  }

  // Check for Authorization header
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7, 7 + MAX_KEY_LENGTH); // First 20 chars of token
    return `token:${token}`;
  }

  // Check for X-Forwarded-For (first IP only, sanitized)
  const forwarded = req.headers.get('X-Forwarded-For');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0];
    const sanitized = sanitizeIp(firstIp);
    if (sanitized) {
      return `ip:${sanitized}`;
    }
    // Invalid IP format - fall through to other options
  }

  // Use remote IP if provided (sanitized)
  const sanitizedRemote = sanitizeIp(remoteIp);
  if (sanitizedRemote) {
    return `ip:${sanitizedRemote}`;
  }

  // Fallback
  return 'anonymous';
}
