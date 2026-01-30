/**
 * E2E Tests - Comprehensive Request Validation
 *
 * Tests all validation scenarios for chat completion requests
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, chatCompletion, generateUUID, createMessage, E2E_ENABLED } from './test-utils';

const describeE2E = E2E_ENABLED ? describe : describe.skip;

describeE2E('E2E: Request Validation', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Messages Validation', () => {
    test('rejects empty messages array', async () => {
      const { response, data } = await chatCompletion({ messages: [] });
      expect(response.status).toBe(400);
      expect((data as any).error.code).toBe('validation_error');
    });

    test('rejects missing messages field', async () => {
      const { response, data } = await chatCompletion({});
      expect(response.status).toBe(400);
      expect((data as any).error.code).toBe('validation_error');
    });

    test('rejects null messages', async () => {
      const { response, data } = await chatCompletion({ messages: null });
      expect(response.status).toBe(400);
    });

    test('rejects messages with invalid type', async () => {
      const { response, data } = await chatCompletion({ messages: 'hello' });
      expect(response.status).toBe(400);
    });

    test('accepts single user message', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
      });
      // Should not be validation error
      expect(response.status).not.toBe(400);
    });

    test('accepts system + user messages', async () => {
      const { response } = await chatCompletion({
        messages: [
          createMessage('system', 'Be helpful'),
          createMessage('user', 'Hi'),
        ],
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts multi-turn conversation', async () => {
      const { response } = await chatCompletion({
        messages: [
          createMessage('user', 'Hi'),
          createMessage('assistant', 'Hello!'),
          createMessage('user', 'How are you?'),
        ],
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects message with empty content', async () => {
      const { response, data } = await chatCompletion({
        messages: [{ role: 'user', content: '' }],
      });
      expect(response.status).toBe(400);
    });

    test('rejects message with missing role', async () => {
      const { response } = await chatCompletion({
        messages: [{ content: 'Hello' }],
      });
      expect(response.status).toBe(400);
    });

    test('rejects message with invalid role', async () => {
      const { response } = await chatCompletion({
        messages: [{ role: 'invalid', content: 'Hello' }],
      });
      expect(response.status).toBe(400);
    });

    test('rejects message with missing content', async () => {
      const { response } = await chatCompletion({
        messages: [{ role: 'user' }],
      });
      expect(response.status).toBe(400);
    });

    test('accepts message with optional name field', async () => {
      const { response } = await chatCompletion({
        messages: [{ role: 'user', content: 'Hi', name: 'test-user' }],
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Model Validation', () => {
    const validModels = ['opus', 'sonnet', 'haiku', 'claude-opus-4', 'claude-sonnet-4', 'OPUS', 'Sonnet'];
    const invalidModels = ['gpt-4', 'invalid-model', 'llama', 'gemini-pro', ''];

    for (const model of validModels) {
      test(`accepts valid model: ${model}`, async () => {
        const { response, data } = await chatCompletion({
          model,
          messages: [createMessage('user', 'Hi')],
        });
        // Should not get validation error for model
        if (response.status === 400) {
          const errorMsg = (data as any).error?.message || '';
          expect(errorMsg).not.toMatch(/model.*invalid|invalid.*model/i);
        }
      });
    }

    for (const model of invalidModels) {
      test(`rejects invalid model: "${model}"`, async () => {
        const { response, data } = await chatCompletion({
          model,
          messages: [createMessage('user', 'Hi')],
        });
        expect(response.status).toBe(400);
        expect((data as any).error.code).toBe('validation_error');
        expect((data as any).error.message).toBeDefined();
      });
    }
  });

  describe('Temperature Validation', () => {
    test('accepts temperature 0', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 0,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts temperature 1', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 1,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts temperature 2', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 2,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts temperature 0.5', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 0.5,
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects temperature > 2', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 2.5,
      });
      expect(response.status).toBe(400);
    });

    test('rejects temperature < 0', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: -0.1,
      });
      expect(response.status).toBe(400);
    });

    test('rejects temperature as string', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: '0.5',
      });
      expect(response.status).toBe(400);
    });
  });

  describe('Session ID Validation', () => {
    test('accepts valid UUID session_id', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: generateUUID(),
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects invalid session_id format', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: 'not-a-uuid',
      });
      expect(response.status).toBe(400);
    });

    test('rejects empty session_id', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: '',
      });
      expect(response.status).toBe(400);
    });

    test('accepts valid X-Session-Id header', async () => {
      const { response } = await chatCompletion(
        { messages: [createMessage('user', 'Hi')] },
        { 'X-Session-Id': generateUUID() }
      );
      expect(response.status).not.toBe(400);
    });

    test('rejects invalid X-Session-Id header', async () => {
      const { response, data } = await chatCompletion(
        { messages: [createMessage('user', 'Hi')] },
        { 'X-Session-Id': 'invalid' }
      );
      expect(response.status).toBe(400);
    });
  });

  describe('Path Validation (Security)', () => {
    test('rejects path traversal in working_directory', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/../etc',
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('path traversal');
    });

    test('rejects path traversal in context_files', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: ['../../etc/passwd'],
      });
      expect(response.status).toBe(400);
    });

    test('rejects access to /etc directory', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: ['/etc/passwd'],
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('system directories');
    });

    test('rejects access to /var directory', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: ['/var/log/syslog'],
      });
      expect(response.status).toBe(400);
    });

    test('rejects path traversal in add_dirs', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        add_dirs: ['../../../etc'],
      });
      expect(response.status).toBe(400);
    });

    test('accepts valid working_directory', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/workspace',
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts valid context_files', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: ['file.txt', 'src/index.ts'],
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Array Bounds Validation', () => {
    test('rejects > 100 context_files', async () => {
      const files = Array.from({ length: 101 }, (_, i) => `file${i}.txt`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: files,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('100 files');
    });

    test('accepts exactly 100 context_files', async () => {
      const files = Array.from({ length: 100 }, (_, i) => `file${i}.txt`);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: files,
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects > 50 allowed_tools', async () => {
      const tools = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        allowed_tools: tools,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('50 tools');
    });

    test('rejects > 50 disallowed_tools', async () => {
      const tools = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        disallowed_tools: tools,
      });
      expect(response.status).toBe(400);
    });

    test('rejects > 20 add_dirs', async () => {
      const dirs = Array.from({ length: 21 }, (_, i) => `/tmp/dir${i}`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        add_dirs: dirs,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('20 directories');
    });

    test('rejects > 20 mcp_config items', async () => {
      const items = Array.from({ length: 21 }, (_, i) => `config${i}`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        mcp_config: items,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('20 items');
    });

    test('rejects > 10 betas', async () => {
      const betas = Array.from({ length: 11 }, (_, i) => `beta${i}`);
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        betas: betas,
      });
      expect(response.status).toBe(400);
      expect((data as any).error.message).toContain('10 beta');
    });
  });

  describe('Optional Fields Validation', () => {
    test('accepts max_tokens as positive integer', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        max_tokens: 100,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts top_p between 0 and 1', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        top_p: 0.9,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts stream boolean', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        stream: false,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts system prompt string', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        system: 'Be helpful and concise.',
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts append_system_prompt', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        append_system_prompt: 'Always be polite.',
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts verbose flag', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        verbose: true,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts ephemeral flag', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        ephemeral: true,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts continue_conversation flag', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        continue_conversation: true,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts permission_mode values', async () => {
      const modes = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];
      for (const mode of modes) {
        const { response } = await chatCompletion({
          messages: [createMessage('user', 'Hi')],
          permission_mode: mode,
        });
        expect(response.status).not.toBe(400);
      }
    });
  });

  describe('Content-Type Validation', () => {
    test('accepts application/json', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
      });
      expect(response.status).not.toBe(415);
    });

    test('handles missing Content-Type', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        body: JSON.stringify({ messages: [createMessage('user', 'Hi')] }),
      });
      // Should either work or give meaningful error
      expect([200, 400, 415]).toContain(response.status);
    });
  });

  describe('JSON Parsing', () => {
    test('rejects invalid JSON body', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });
      expect(response.status).toBe(400);
      const data = await response.json();
      expect((data as any).error.code).toBe('json_parse_error');
    });

    test('rejects truncated JSON', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"messages": [{"role": "user"',
      });
      expect(response.status).toBe(400);
    });

    test('rejects empty body', async () => {
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '',
      });
      expect(response.status).toBe(400);
    });
  });
});
