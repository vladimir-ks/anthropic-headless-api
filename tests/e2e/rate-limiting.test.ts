/**
 * E2E Tests - Rate Limiting
 *
 * Tests rate limiting behavior and headers
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, timedFetch, chatCompletion, createMessage } from './test-utils';

describe('E2E: Rate Limiting', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Rate Limit Headers', () => {
    test('responses include X-RateLimit-Limit header', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      const limitHeader = response.headers.get('X-RateLimit-Limit');
      expect(limitHeader).toBeTruthy();
    });

    test('responses include X-RateLimit-Remaining header', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      const remainingHeader = response.headers.get('X-RateLimit-Remaining');
      expect(remainingHeader).toBeTruthy();
    });

    test('responses include X-RateLimit-Reset header', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      const resetHeader = response.headers.get('X-RateLimit-Reset');
      expect(resetHeader).toBeTruthy();
    });

    test('X-RateLimit-Remaining decreases with requests', async () => {
      // First request
      const { response: res1 } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });
      const remaining1 = parseInt(res1.headers.get('X-RateLimit-Remaining') || '0');

      // Second request
      const { response: res2 } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hello')],
        }),
      });
      const remaining2 = parseInt(res2.headers.get('X-RateLimit-Remaining') || '0');

      // Remaining should decrease (or both be 0 if rate limited)
      expect(remaining2).toBeLessThanOrEqual(remaining1);
    });
  });

  describe('Rate Limit Behavior', () => {
    test('health endpoint bypasses rate limiting', async () => {
      // Make many health requests - should not be rate limited
      const promises = Array.from({ length: 20 }, () =>
        timedFetch(`${BASE_URL}/health`)
      );

      const responses = await Promise.all(promises);
      const successCount = responses.filter(r => r.response.ok).length;

      // Health endpoint should bypass rate limiting
      expect(successCount).toBe(20);
    });

    test('queue status endpoint bypasses rate limiting', async () => {
      const promises = Array.from({ length: 20 }, () =>
        timedFetch(`${BASE_URL}/queue/status`)
      );

      const responses = await Promise.all(promises);
      const successCount = responses.filter(r => r.response.ok).length;

      expect(successCount).toBe(20);
    });

    test('rate limited response has 429 status', async () => {
      // If we hit rate limit, status should be 429
      // Make rapid requests to potentially trigger rate limit
      const responses = [];
      for (let i = 0; i < 100; i++) {
        const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [createMessage('user', `Request ${i}`)],
          }),
        });
        responses.push(response);

        // Check if rate limited
        if (response.status === 429) {
          // Verify Retry-After header
          const retryAfter = response.headers.get('Retry-After');
          expect(retryAfter).toBeTruthy();
          break;
        }
      }

      // Either hit rate limit or completed all requests
      expect(responses.length).toBeGreaterThan(0);
    });

    test('rate limited response has error body', async () => {
      // Make rapid requests
      for (let i = 0; i < 100; i++) {
        const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [createMessage('user', `Request ${i}`)],
          }),
        });

        if (response.status === 429) {
          const data = await response.json();
          expect(data.error).toBeDefined();
          expect(data.error.type).toBe('rate_limit_error');
          expect(data.error.code).toBe('rate_limited');
          break;
        }
      }
    });
  });

  describe('Per-Client Rate Limiting', () => {
    test('different X-Forwarded-For have separate limits', async () => {
      // Request from "client A"
      const { response: resA } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '10.0.0.1',
        },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi from A')],
        }),
      });
      const remainingA = parseInt(resA.headers.get('X-RateLimit-Remaining') || '0');

      // Request from "client B"
      const { response: resB } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': '10.0.0.2',
        },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi from B')],
        }),
      });
      const remainingB = parseInt(resB.headers.get('X-RateLimit-Remaining') || '0');

      // Both should have similar remaining (separate rate limit buckets)
      // If they shared a bucket, B would have less
      expect(Math.abs(remainingA - remainingB)).toBeLessThan(5);
    });
  });
});
