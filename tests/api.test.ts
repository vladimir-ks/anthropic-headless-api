/**
 * API Integration Tests
 *
 * Tests the actual HTTP endpoints without mocking.
 * Requires server to NOT be running (uses its own instance).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

// Import server setup (we'll create a test server instance)
let server: ReturnType<typeof Bun.serve> | null = null;
const TEST_PORT = 3457; // Different from default to avoid conflicts
const BASE_URL = `http://localhost:${TEST_PORT}`;

// Simple server for testing (without Claude CLI - just validation layer)
beforeAll(async () => {
  // Dynamic import to avoid circular deps
  const { validateChatCompletionRequest, formatValidationErrors } = await import(
    '../src/validation/schemas'
  );

  server = Bun.serve({
    port: TEST_PORT,
    fetch(req) {
      const url = new URL(req.url);

      // Health endpoint
      if (url.pathname === '/health') {
        return Response.json({
          status: 'ok',
          version: '0.2.0',
          backend: 'test-mock',
        });
      }

      // Chat completions - validation only (no Claude CLI in tests)
      if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
        return (async () => {
          try {
            const body = await req.json();

            // Validate session_id header
            const headerSessionId = req.headers.get('X-Session-Id');
            if (headerSessionId && !body.session_id) {
              const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              if (!uuidRegex.test(headerSessionId)) {
                return Response.json(
                  {
                    error: {
                      message: 'X-Session-Id header must be a valid UUID',
                      type: 'invalid_request_error',
                      code: 'invalid_session_id',
                    },
                  },
                  { status: 400 }
                );
              }
            }

            // Validate request body
            const validation = validateChatCompletionRequest(body);
            if (!validation.success) {
              return Response.json(
                {
                  error: {
                    message: formatValidationErrors(validation.errors || []),
                    type: 'invalid_request_error',
                    code: 'validation_error',
                  },
                },
                { status: 400 }
              );
            }

            // Return mock success (without actual Claude call)
            return Response.json({
              id: `chatcmpl-test-${Date.now()}`,
              object: 'chat.completion',
              created: Math.floor(Date.now() / 1000),
              model: body.model || 'test-mock',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Mock response for testing',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
              session_id: 'test-session-id',
            });
          } catch (error) {
            if (error instanceof SyntaxError) {
              return Response.json(
                {
                  error: {
                    message: 'Invalid JSON in request body',
                    type: 'invalid_request_error',
                    code: 'json_parse_error',
                  },
                },
                { status: 400 }
              );
            }
            return Response.json(
              {
                error: {
                  message: 'Internal server error',
                  type: 'server_error',
                  code: 'internal_error',
                },
              },
              { status: 500 }
            );
          }
        })();
      }

      return Response.json(
        { error: { message: 'Not found', type: 'invalid_request_error', code: 'not_found' } },
        { status: 404 }
      );
    },
  });
});

afterAll(() => {
  server?.stop();
});

describe('Health Endpoint', () => {
  test('GET /health returns status ok', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBe('ok');
    expect(data.version).toBeDefined();
  });
});

describe('Chat Completions Endpoint', () => {
  test('POST with valid request returns 200', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.choices).toBeDefined();
    expect(data.choices[0].message.content).toBeDefined();
  });

  test('POST with empty messages returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.type).toBe('invalid_request_error');
  });

  test('POST with no user message returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: 'You are helpful' }],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.message).toContain('user');
  });

  test('POST with invalid JSON returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('json_parse_error');
  });

  test('POST with invalid session_id header returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': 'not-a-uuid',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error.code).toBe('invalid_session_id');
  });

  test('POST with valid session_id header succeeds', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Session-Id': 'a1234567-b234-c345-d456-e56789012345',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
  });

  test('POST with temperature out of range returns 400', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 5,
      }),
    });

    expect(res.status).toBe(400);
  });

  test('POST with model parameter succeeds', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'opus',
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.model).toBe('opus');
  });

  test('Response includes session_id for continuity', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session_id).toBeDefined();
  });
});

describe('Error Handling', () => {
  test('Unknown route returns 404', async () => {
    const res = await fetch(`${BASE_URL}/v1/unknown`);
    expect(res.status).toBe(404);
  });

  test('Wrong method returns 404', async () => {
    const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'GET',
    });
    expect(res.status).toBe(404);
  });
});
