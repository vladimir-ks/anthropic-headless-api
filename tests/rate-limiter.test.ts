/**
 * Rate limiter tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RateLimiter } from '../src/middleware/rate-limiter';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    rateLimiter = new RateLimiter({
      maxRequests: 5,
      windowMs: 1000, // 1 second window for testing
      enabled: true,
    });
  });

  afterEach(() => {
    rateLimiter.stop(); // Clean up interval
  });

  test('allows requests under limit', () => {
    const clientId = 'test-client';
    for (let i = 0; i < 5; i++) {
      const result = rateLimiter.check(clientId);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4 - i);
    }
  });

  test('blocks requests over limit', () => {
    const clientId = 'test-client';

    // Use up all requests
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(clientId);
    }

    // Next request should be blocked
    const result = rateLimiter.check(clientId);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  test('tracks different clients separately', () => {
    // Client 1 uses all requests
    for (let i = 0; i < 5; i++) {
      rateLimiter.check('client-1');
    }

    // Client 2 should still have full quota
    const result = rateLimiter.check('client-2');
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });

  test('respects window expiration', async () => {
    const clientId = 'test-client';

    // Use up all requests
    for (let i = 0; i < 5; i++) {
      rateLimiter.check(clientId);
    }

    // Should be blocked
    expect(rateLimiter.check(clientId).allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Should be allowed again
    const result = rateLimiter.check(clientId);
    expect(result.allowed).toBe(true);
  });

  test('returns reset timestamp', () => {
    const clientId = 'test-client';
    const result = rateLimiter.check(clientId);

    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test('disabled rate limiter allows all requests', () => {
    const disabledLimiter = new RateLimiter({
      maxRequests: 1,
      windowMs: 1000,
      enabled: false,
    });

    const clientId = 'test-client';

    // Even with max 1 request, all should pass when disabled
    for (let i = 0; i < 10; i++) {
      const result = disabledLimiter.check(clientId);
      expect(result.allowed).toBe(true);
    }

    disabledLimiter.stop();
  });
});
