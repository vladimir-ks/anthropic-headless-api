/**
 * E2E Tests - Error Handling
 *
 * Tests all error scenarios and error response formats
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, chatCompletion, timedFetch, createMessage } from './test-utils';

describe('E2E: Error Handling', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Error Response Format', () => {
    test('validation error has correct structure', async () => {
      const { response, data } = await chatCompletion({ messages: [] });

      expect(response.status).toBe(400);
      expect(data).toHaveProperty('error');

      const error = (data as any).error;
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('type');
      expect(error).toHaveProperty('code');

      expect(error.type).toBe('invalid_request_error');
      expect(error.code).toBe('validation_error');
      expect(typeof error.message).toBe('string');
    });

    test('JSON parse error has correct structure', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error.code).toBe('json_parse_error');
      expect(data.error.type).toBe('invalid_request_error');
    });

    test('error message is descriptive', async () => {
      const { data } = await chatCompletion({
        messages: [{ role: 'invalid', content: 'Hi' }],
      });

      const error = (data as any).error;
      expect(error.message.length).toBeGreaterThan(10);
    });
  });

  describe('Validation Error Details', () => {
    test('missing required field error is clear', async () => {
      const { data } = await chatCompletion({});
      expect((data as any).error.message).toMatch(/messages/i);
    });

    test('invalid type error is clear', async () => {
      const { data } = await chatCompletion({
        messages: 'not an array',
      });
      expect((data as any).error.message).toMatch(/array|type/i);
    });

    test('out of range error is clear', async () => {
      const { data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 5,
      });
      expect((data as any).error.message).toMatch(/temperature|range|2/i);
    });
  });

  describe('HTTP Status Codes', () => {
    test('400 for validation errors', async () => {
      const { response } = await chatCompletion({ messages: [] });
      expect(response.status).toBe(400);
    });

    test('400 for invalid JSON', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{invalid}',
      });
      expect(response.status).toBe(400);
    });

    test('404 for unknown endpoints', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/unknown`);
      expect(response.status).toBe(404);
    });

    test('413 for oversized request', async () => {
      const largeContent = 'x'.repeat(2 * 1024 * 1024);
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(largeContent.length + 100),
        },
        body: JSON.stringify({
          messages: [createMessage('user', largeContent)],
        }),
      });
      expect(response.status).toBe(413);
    });
  });

  describe('Error Types', () => {
    test('invalid_request_error for bad input', async () => {
      const { data } = await chatCompletion({ messages: [] });
      expect((data as any).error.type).toBe('invalid_request_error');
    });

    test('invalid_request_error for invalid session_id', async () => {
      const { data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: 'not-valid',
      });
      expect((data as any).error.type).toBe('invalid_request_error');
    });
  });

  describe('Error Recovery', () => {
    test('server continues after validation error', async () => {
      // Cause an error
      await chatCompletion({ messages: [] });

      // Server should still work
      const { response } = await timedFetch(`${BASE_URL}/health`);
      expect(response.ok).toBe(true);
    });

    test('server continues after JSON parse error', async () => {
      // Cause an error
      await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid',
      });

      // Server should still work
      const { response } = await timedFetch(`${BASE_URL}/health`);
      expect(response.ok).toBe(true);
    });

    test('server handles multiple concurrent errors', async () => {
      // Send multiple invalid requests in parallel
      const promises = Array.from({ length: 5 }, () =>
        chatCompletion({ messages: [] })
      );
      await Promise.all(promises);

      // Server should still work
      const { response } = await timedFetch(`${BASE_URL}/health`);
      expect(response.ok).toBe(true);
    });
  });

  describe('Content-Length Validation', () => {
    test('handles mismatched Content-Length', async () => {
      const body = JSON.stringify({
        messages: [createMessage('user', 'Hi')],
      });

      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': String(body.length + 1000),
        },
        body,
      });

      // Should handle gracefully (not hang)
      expect([200, 400, 408]).toContain(response.status);
    });
  });

  describe('Graceful Degradation', () => {
    test('health check always works', async () => {
      // Health check should always succeed
      const { response } = await timedFetch(`${BASE_URL}/health`);
      expect(response.ok).toBe(true);
    });

    test('queue status always works', async () => {
      const { response } = await timedFetch(`${BASE_URL}/queue/status`);
      expect(response.ok).toBe(true);
    });

    test('models endpoint always works', async () => {
      const { response } = await timedFetch(`${BASE_URL}/v1/models`);
      expect(response.ok).toBe(true);
    });
  });

  describe('Specific Error Scenarios', () => {
    test('empty message content error', async () => {
      const { response, data } = await chatCompletion({
        messages: [{ role: 'user', content: '' }],
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toMatch(/content|empty/i);
    });

    test('path traversal error', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/../../../etc',
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('path traversal');
    });

    test('array overflow error', async () => {
      const tooManyFiles = Array.from({ length: 101 }, (_, i) => `file${i}.txt`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: tooManyFiles,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('100');
    });
  });
});
