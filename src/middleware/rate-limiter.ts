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
      const oldestInWindow = Math.min(...entry.timestamps);
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
   * Record a request (used after check returns allowed)
   * This is called separately in case the request fails before processing
   */
  record(key: string): void {
    // The check() method already records the timestamp
    // This method exists for API clarity
  }

  /**
   * Get current status for a key
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
   */
  private cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, entry] of this.entries) {
      // Remove timestamps outside window
      entry.timestamps = entry.timestamps.filter((t) => t > windowStart);

      // Remove entry if empty and not blocked
      if (entry.timestamps.length === 0 && !entry.blocked) {
        this.entries.delete(key);
      }

      // Clear expired blocks
      if (entry.blocked && entry.blockedUntil && now >= entry.blockedUntil) {
        entry.blocked = false;
        entry.blockedUntil = undefined;
      }
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

/**
 * Extract rate limit key from request
 *
 * Priority:
 * 1. X-API-Key header
 * 2. Authorization Bearer token (first 20 chars)
 * 3. X-Forwarded-For header (first IP)
 * 4. Remote IP
 * 5. "anonymous" fallback
 */
export function getRateLimitKey(req: Request, remoteIp?: string): string {
  // Check for API key header
  const apiKey = req.headers.get('X-API-Key');
  if (apiKey) {
    return `apikey:${apiKey.substring(0, 20)}`;
  }

  // Check for Authorization header
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ')) {
    const token = auth.slice(7, 27); // First 20 chars of token
    return `token:${token}`;
  }

  // Check for X-Forwarded-For
  const forwarded = req.headers.get('X-Forwarded-For');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    return `ip:${firstIp}`;
  }

  // Use remote IP if provided
  if (remoteIp) {
    return `ip:${remoteIp}`;
  }

  // Fallback
  return 'anonymous';
}
