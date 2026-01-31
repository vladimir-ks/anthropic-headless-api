/**
 * Rate limiter tests
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RateLimiter, getRateLimitKey } from '../src/middleware/rate-limiter';

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

describe('getRateLimitKey', () => {
  test('uses API key when present', () => {
    const req = new Request('http://test.com', {
      headers: { 'X-API-Key': 'sk-1234567890abcdefghij' },
    });
    // First 20 chars: sk-1234567890abcdefg (20 chars)
    expect(getRateLimitKey(req)).toBe('apikey:sk-1234567890abcdefg');
  });

  test('truncates long API keys', () => {
    const req = new Request('http://test.com', {
      headers: { 'X-API-Key': 'sk-verylongapikeymorethan20characters' },
    });
    expect(getRateLimitKey(req)).toBe('apikey:sk-verylongapikeymor');
  });

  test('uses Bearer token when no API key', () => {
    const req = new Request('http://test.com', {
      headers: { 'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
    });
    // First 20 chars after "Bearer "
    expect(getRateLimitKey(req)).toBe('token:eyJhbGciOiJIUzI1NiIs');
  });

  test('uses X-Forwarded-For first IP', () => {
    const req = new Request('http://test.com', {
      headers: { 'X-Forwarded-For': '192.168.1.1, 10.0.0.1, 172.16.0.1' },
    });
    expect(getRateLimitKey(req)).toBe('ip:192.168.1.1');
  });

  test('validates IPv6 addresses', () => {
    const req = new Request('http://test.com', {
      headers: { 'X-Forwarded-For': '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
    });
    // IPv6 39 chars - should pass through fully
    expect(getRateLimitKey(req)).toBe('ip:2001:0db8:85a3:0000:0000:8a2e:0370:7334');
  });

  test('rejects malicious IP with special chars', () => {
    const req = new Request('http://test.com', {
      headers: { 'X-Forwarded-For': '<script>alert(1)</script>' },
    });
    // Should fall through to anonymous since IP is invalid
    expect(getRateLimitKey(req)).toBe('anonymous');
  });

  test('handles very long X-Forwarded-For', () => {
    // Create a long but valid-looking IP string
    const longIp = '1234567890'.repeat(100);
    const req = new Request('http://test.com', {
      headers: { 'X-Forwarded-For': longIp },
    });
    // Should be truncated (45 chars max) - result is ip: + truncated string
    const result = getRateLimitKey(req);
    expect(result.length).toBeLessThanOrEqual(48); // "ip:" + max 45 chars
  });

  test('uses remote IP when no headers', () => {
    const req = new Request('http://test.com');
    expect(getRateLimitKey(req, '10.0.0.100')).toBe('ip:10.0.0.100');
  });

  test('returns anonymous as fallback', () => {
    const req = new Request('http://test.com');
    expect(getRateLimitKey(req)).toBe('anonymous');
  });

  test('sanitizes remote IP with invalid chars', () => {
    const req = new Request('http://test.com');
    // Invalid remote IP should fall to anonymous
    expect(getRateLimitKey(req, 'invalid<>ip')).toBe('anonymous');
  });
});
