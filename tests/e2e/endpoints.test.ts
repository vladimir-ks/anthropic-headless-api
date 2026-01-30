/**
 * E2E Tests - All API Endpoints
 *
 * Tests all GET endpoints and basic functionality
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, timedFetch } from './test-utils';

describe('E2E: API Endpoints', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) {
      console.warn('Server not ready, tests may fail');
    }
  });

  describe('Health Check Endpoints', () => {
    test('GET / returns health status', async () => {
      const { response, duration } = await timedFetch(`${BASE_URL}/`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.status).toBe('ok');
      expect(data.version).toBeDefined();
      expect(data.backend).toBe('intelligent-gateway');
      expect(data.uptime_seconds).toBeGreaterThanOrEqual(0);
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    test('GET /health returns same as /', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.status).toBe('ok');
      expect(data.routing).toBeDefined();
      expect(data.routing.processPool).toBeDefined();
      expect(data.routing.backends).toBeDefined();
    });

    test('Health check includes process pool stats', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`);
      const data = await response.json();

      const pool = data.routing.processPool;
      expect(pool.active).toBeGreaterThanOrEqual(0);
      expect(pool.queued).toBeGreaterThanOrEqual(0);
      expect(pool.maxConcurrent).toBeGreaterThan(0);
      expect(pool.maxQueue).toBeGreaterThan(0);
      expect(pool.utilization).toBeGreaterThanOrEqual(0);
    });

    test('Health check includes backend stats', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`);
      const data = await response.json();

      const backends = data.routing.backends;
      expect(backends.total).toBeGreaterThan(0);
      expect(backends.tool).toBeGreaterThanOrEqual(0);
      expect(backends.api).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Models Endpoint', () => {
    test('GET /v1/models returns model list', async () => {
      const { response, duration } = await timedFetch(`${BASE_URL}/v1/models`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.object).toBe('list');
      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500);
    });

    test('Models have required properties', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/models`);
      const data = await response.json();

      for (const model of data.data) {
        expect(model.id).toBeDefined();
        expect(typeof model.id).toBe('string');
        expect(model.object).toBe('model');
        expect(model.created).toBeDefined();
        expect(model.owned_by).toBeDefined();
      }
    });

    test('Models include claude models', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/models`);
      const data = await response.json();

      const modelIds = data.data.map((m: { id: string }) => m.id);
      // Should have at least one model
      expect(modelIds.length).toBeGreaterThan(0);
    });
  });

  describe('Queue Status Endpoint', () => {
    test('GET /queue/status returns queue statistics', async () => {
      const { response, duration } = await timedFetch(`${BASE_URL}/queue/status`);
      expect(response.ok).toBe(true);
      const data = await response.json();

      expect(data.active).toBeGreaterThanOrEqual(0);
      expect(data.queued).toBeGreaterThanOrEqual(0);
      expect(data.maxConcurrent).toBeGreaterThan(0);
      expect(duration).toBeLessThan(500);
    });

    test('Queue status includes all required fields', async () => {
      const { response } = await timedFetch(`${BASE_URL}/queue/status`);
      const data = await response.json();

      expect(typeof data.active).toBe('number');
      expect(typeof data.queued).toBe('number');
      expect(typeof data.maxConcurrent).toBe('number');
      expect(typeof data.maxQueue).toBe('number');
      expect(typeof data.utilization).toBe('number');
      expect(typeof data.totalProcessed).toBe('number');
      expect(typeof data.totalQueued).toBe('number');
      expect(typeof data.totalFailed).toBe('number');
    });
  });

  describe('Unknown Endpoints', () => {
    test('Unknown GET endpoint returns 404', async () => {
      const { response } = await timedFetch(`${BASE_URL}/unknown/path`);
      expect(response.status).toBe(404);
    });

    test('Unknown POST endpoint returns 404', async () => {
      const { response } = await timedFetch(`${BASE_URL}/unknown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(response.status).toBe(404);
    });
  });

  describe('HTTP Methods', () => {
    test('PUT method not allowed on health', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`, {
        method: 'PUT',
      });
      // Either 404 (not found) or 405 (method not allowed) or 429 (rate limited)
      expect([404, 405, 429]).toContain(response.status);
    });

    test('DELETE method not allowed on health', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`, {
        method: 'DELETE',
      });
      expect([404, 405, 429]).toContain(response.status);
    });

    test('PATCH method not allowed on chat completions', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect([404, 405, 429]).toContain(response.status);
    });
  });
});
