/**
 * Session Continuity Integration Tests
 *
 * Tests end-to-end session management and conversation continuity
 */

/**
 * NOTE: These integration tests require the server to be running
 * Run the server first: bun run start
 * Then run these tests: bun test tests/session-continuity.test.ts
 */

import { describe, test, expect } from 'bun:test';

const TEST_PORT = 3456; // Use default port
const BASE_URL = `http://127.0.0.1:${TEST_PORT}`;

describe('Session Continuity', () => {
  test('should create new session on first request', async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Say hi' }],
        stream: false,
      }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();

    // Should have session_id in response
    expect(data.session_id).toBeDefined();
    expect(typeof data.session_id).toBe('string');
    expect(data.session_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  }, 180000); // 3 minute timeout for actual Claude call

  test('should accept session_id in request body', async () => {
    const mockSessionId = '12345678-1234-1234-1234-123456789012';

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Hello' }],
        session_id: mockSessionId,
        stream: false,
      }),
    });

    // Should accept the request (may fail at Claude CLI level, but validation passes)
    expect(response.status).not.toBe(400); // Not a validation error
  }, 180000);

  test('should accept session_id via X-Session-Id header', async () => {
    const mockSessionId = '12345678-1234-1234-1234-123456789012';

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': mockSessionId,
      },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }),
    });

    // Should accept the request (may fail at Claude CLI level, but validation passes)
    expect(response.status).not.toBe(400); // Not a validation error
  }, 180000);

  test('should reject invalid session_id format in body', async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Hello' }],
        session_id: 'invalid-session-id',
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.type).toBe('invalid_request_error');
  });

  test('should reject invalid session_id format in header', async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': 'not-a-uuid',
      },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Hello' }],
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.message).toMatch(/session.*id/i);
  });

  test('should include session_id in streaming final chunk', async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Say "test"' }],
        stream: true,
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');

    // Read SSE stream
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    if (!reader) return;

    const decoder = new TextDecoder();
    let finalChunk: any = null;
    let doneReceived = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n').filter((l) => l.startsWith('data: '));

        for (const line of lines) {
          const data = line.slice(6); // Remove "data: "
          if (data === '[DONE]') {
            doneReceived = true;
            break;
          }

          try {
            const chunk = JSON.parse(data);
            if (chunk.choices?.[0]?.finish_reason === 'stop') {
              finalChunk = chunk;
            }
          } catch {
            // Ignore parse errors
          }
        }

        if (doneReceived) break;
      }
    } finally {
      reader.releaseLock();
    }

    // Should receive [DONE] marker
    expect(doneReceived).toBe(true);

    // Final chunk should have session_id
    expect(finalChunk).toBeDefined();
    expect(finalChunk.session_id).toBeDefined();
    expect(typeof finalChunk.session_id).toBe('string');
  }, 180000);

  test('should handle multi-turn conversation with session continuity', async () => {
    // First message
    const firstResponse = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: 'Remember this number: 42' }],
        stream: false,
      }),
    });

    expect(firstResponse.status).toBe(200);
    const firstData = await firstResponse.json();
    const sessionId = firstData.session_id;

    expect(sessionId).toBeDefined();

    // Second message using same session
    const secondResponse = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'haiku',
        messages: [
          { role: 'user', content: 'Remember this number: 42' },
          { role: 'assistant', content: firstData.choices[0].message.content },
          { role: 'user', content: 'What number did I ask you to remember?' },
        ],
        session_id: sessionId,
        stream: false,
      }),
    });

    expect(secondResponse.status).toBe(200);
    const secondData = await secondResponse.json();

    // Should return the same session_id
    expect(secondData.session_id).toBe(sessionId);

    // Response should reference the number 42 (context maintained)
    expect(secondData.choices[0].message.content).toMatch(/42/);
  }, 300000); // 5 minute timeout for two Claude calls
});

describe('Model Validation', () => {
  test('should accept valid model names', async () => {
    const validModels = ['opus', 'sonnet', 'haiku', 'claude-opus-4', 'OPUS'];

    for (const model of validModels) {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          stream: false,
        }),
      });

      // Should not be validation error (may fail at Claude level)
      if (response.status === 400) {
        const data = await response.json();
        expect(data.error?.code).not.toBe('validation_error');
      }
    }
  }, 180000);

  test('should reject invalid model names', async () => {
    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'invalid-model-xyz',
        messages: [{ role: 'user', content: 'Hi' }],
        stream: false,
      }),
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.type).toBe('invalid_request_error');
    expect(data.error.code).toBe('validation_error');
  });
});

describe('Request Size Limits', () => {
  test('should reject oversized requests', async () => {
    const largeContent = 'x'.repeat(2 * 1024 * 1024); // 2MB

    const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(largeContent.length),
      },
      body: JSON.stringify({
        model: 'haiku',
        messages: [{ role: 'user', content: largeContent }],
        stream: false,
      }),
    });

    expect(response.status).toBe(413);
    const data = await response.json();
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe('request_too_large');
  });
});
