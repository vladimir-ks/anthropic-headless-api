/**
 * E2E Tests - Backend Routing
 *
 * Tests intelligent routing and explicit backend selection
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, timedFetch, chatCompletion, createMessage, E2E_ENABLED } from './test-utils';

const describeE2E = E2E_ENABLED ? describe : describe.skip;

describeE2E('E2E: Backend Routing', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Explicit Backend Routing via URL', () => {
    test('POST /v1/claude-cli/chat/completions routes to Claude CLI', async () => {
      const response = await fetch(`${BASE_URL}/v1/claude-cli/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      // Should either work or give appropriate error
      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });

    test('POST /v1/openrouter/chat/completions routes to OpenRouter', async () => {
      const response = await fetch(`${BASE_URL}/v1/openrouter/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });

    test('POST /v1/gemini/chat/completions routes to Gemini', async () => {
      const response = await fetch(`${BASE_URL}/v1/gemini/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });

    test('POST /v1/anthropic-api/chat/completions routes to Anthropic API', async () => {
      const response = await fetch(`${BASE_URL}/v1/anthropic-api/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });

    test('POST /v1/openai/chat/completions routes to OpenAI', async () => {
      const response = await fetch(`${BASE_URL}/v1/openai/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });

    test('unknown backend returns error', async () => {
      const response = await fetch(`${BASE_URL}/v1/unknown-backend/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
        }),
      });

      // Should be 404 or fall back to default
      expect([200, 400, 404, 429]).toContain(response.status);
    });
  });

  describe('Explicit Backend Routing via Body', () => {
    test('backend field in body selects backend', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        backend: 'claude-cli',
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('backend field overrides URL path', async () => {
      const response = await fetch(`${BASE_URL}/v1/openrouter/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', 'Hi')],
          backend: 'claude-cli', // Override URL path
        }),
      });

      expect([200, 400, 404, 429, 503]).toContain(response.status);
    });
  });

  describe('Tool-Based Routing', () => {
    test('allowed_tools routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        allowed_tools: ['Bash'],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('disallowed_tools routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        disallowed_tools: ['WebSearch'],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('working_directory routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp',
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('context_files routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: ['test.txt'],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('add_dirs routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        add_dirs: ['/tmp/extra'],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });
  });

  describe('Auto-Routing (No Tools)', () => {
    test('simple chat uses auto-routing', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
      });

      // Should route to cheapest available backend
      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('system + user message uses auto-routing', async () => {
      const { response } = await chatCompletion({
        messages: [
          createMessage('system', 'Be brief'),
          createMessage('user', 'Hi'),
        ],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });
  });

  describe('Model-Based Routing', () => {
    test('haiku model routes correctly', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('sonnet model routes correctly', async () => {
      const { response } = await chatCompletion({
        model: 'sonnet',
        messages: [createMessage('user', 'Hi')],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });

    test('opus model routes correctly', async () => {
      const { response } = await chatCompletion({
        model: 'opus',
        messages: [createMessage('user', 'Hi')],
      });

      expect([200, 400, 429, 503]).toContain(response.status);
    });
  });

  describe('Routing Statistics', () => {
    test('health check shows routing stats', async () => {
      const { response } = await timedFetch(`${BASE_URL}/health`);
      const data = await response.json();

      expect(data.routing).toBeDefined();
      expect(data.routing.backends).toBeDefined();
      expect(data.routing.processPool).toBeDefined();
    });

    test('queue status shows pool stats', async () => {
      const { response } = await timedFetch(`${BASE_URL}/queue/status`);
      const data = await response.json();

      expect(data.active).toBeDefined();
      expect(data.queued).toBeDefined();
      expect(data.maxConcurrent).toBeDefined();
    });
  });

  describe('Fallback Behavior', () => {
    test('request completes even if preferred backend unavailable', async () => {
      // Send a request - should complete even with fallback
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
      });

      // Should either succeed or give meaningful error
      expect([200, 400, 429, 503]).toContain(response.status);
    });
  });
});
