/**
 * E2E Tests - CORS Handling
 *
 * Tests Cross-Origin Resource Sharing behavior
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, timedFetch, createMessage } from './test-utils';

describe('E2E: CORS Handling', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Preflight Requests', () => {
    test('OPTIONS / returns CORS headers', async () => {
      const { response } = await timedFetch(`${BASE_URL}/`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'GET',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
      expect(response.headers.get('Access-Control-Allow-Methods')).toBeTruthy();
    });

    test('OPTIONS /v1/chat/completions returns CORS headers', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });

    test('OPTIONS allows Content-Type header', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Headers': 'Content-Type',
        },
      });

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers');
      expect(allowHeaders).toBeTruthy();
      expect(allowHeaders?.toLowerCase()).toContain('content-type');
    });

    test('OPTIONS allows X-Session-Id header', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Headers': 'X-Session-Id',
        },
      });

      const allowHeaders = response.headers.get('Access-Control-Allow-Headers');
      expect(allowHeaders).toBeTruthy();
    });
  });

  describe('CORS Response Headers', () => {
    test('GET /health includes CORS headers', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`, {
        headers: { Origin: 'https://example.com' },
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });

    test('POST response includes CORS headers', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });

    test('Error responses include CORS headers', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({ messages: [] }),
      });

      expect(response.status).toBe(400);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    });
  });

  describe('CORS with Different Origins', () => {
    const origins = [
      'https://example.com',
      'https://localhost:3000',
      'http://localhost:8080',
      'https://app.mysite.com',
    ];

    for (const origin of origins) {
      test(`accepts origin: ${origin}`, async () => {
        const { response } = await timedFetch(`${BASE_URL}/health`, {
          headers: { Origin: origin },
        });

        expect(response.ok).toBe(true);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
      });
    }
  });

  describe('CORS Credentials', () => {
    test('handles credentials preflight', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Content-Type, Authorization',
        },
      });

      expect(response.status).toBe(204);
    });
  });
});
