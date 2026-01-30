/**
 * E2E Tests - Streaming Responses
 *
 * Tests Server-Sent Events (SSE) streaming behavior
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, createMessage, readSSEStream, E2E_ENABLED } from './test-utils';

const describeE2E = E2E_ENABLED ? describe : describe.skip;

describeE2E('E2E: Streaming Responses', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Streaming Request Validation', () => {
    test('accepts stream: true', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "hello"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toBe('text/event-stream');
    }, 180000);

    test('accepts stream: false', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "hello"')],
          stream: false,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('application/json');
    }, 180000);

    test('defaults to non-streaming', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "hello"')],
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data).toHaveProperty('choices');
    }, 180000);
  });

  describe('SSE Format', () => {
    test('streaming response has correct content-type', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "test"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.headers.get('content-type')).toBe('text/event-stream');
    }, 180000);

    test('streaming response sends [DONE] marker', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "x"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      const { doneReceived } = await readSSEStream(response);
      expect(doneReceived).toBe(true);
    }, 180000);

    test('streaming chunks are valid JSON', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "test"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      const { chunks } = await readSSEStream(response);

      // All chunks should be valid objects
      for (const chunk of chunks) {
        expect(typeof chunk).toBe('object');
        expect(chunk).not.toBeNull();
      }
    }, 180000);

    test('final chunk has finish_reason', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say exactly "done"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      const { finalChunk } = await readSSEStream(response);

      expect(finalChunk).toBeDefined();
      expect((finalChunk as any).choices[0].finish_reason).toBe('stop');
    }, 180000);

    test('final chunk includes session_id', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "hi"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      const { finalChunk } = await readSSEStream(response);

      expect(finalChunk).toBeDefined();
      expect((finalChunk as any).session_id).toBeDefined();
      expect(typeof (finalChunk as any).session_id).toBe('string');
    }, 180000);
  });

  describe('Streaming Error Handling', () => {
    test('validation error returns JSON not SSE', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [],
          stream: true,
        }),
      });

      expect(response.status).toBe(400);
      // Should be JSON error, not SSE
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    test('session_id validation error with stream: true', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
          stream: true,
          session_id: 'invalid',
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error.code).toBe('validation_error');
    });
  });

  describe('Streaming CORS Headers', () => {
    test('SSE response includes CORS headers', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://example.com',
        },
        body: JSON.stringify({
          messages: [createMessage('user', 'Say "hi"')],
          stream: true,
          model: 'haiku',
        }),
      });

      expect(response.ok).toBe(true);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
    }, 180000);
  });
});
