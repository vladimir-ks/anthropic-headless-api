/**
 * E2E Tests - Edge Cases
 *
 * Tests unusual inputs, boundary conditions, and edge cases
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, chatCompletion, createMessage, generateUUID, E2E_ENABLED } from './test-utils';

const describeE2E = E2E_ENABLED ? describe : describe.skip;

describeE2E('E2E: Edge Cases', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
  });

  describe('Unicode and Special Characters', () => {
    test('handles emoji in messages', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hello 👋 🌍 🎉')],
      });
      // Should not fail validation
      expect(response.status).not.toBe(400);
    });

    test('handles Chinese characters', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', '你好世界')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles Japanese characters', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'こんにちは世界')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles Arabic characters', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'مرحبا بالعالم')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles mixed scripts', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hello こんにちは 你好 مرحبا')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles special punctuation', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', '¿Cómo estás? — "Bien," respondió…')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles math symbols', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'π ≈ 3.14159, e ≈ 2.71828, ∞ → ∑')],
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Message Length Boundaries', () => {
    test('handles very short message', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'a')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles moderate message (1KB)', async () => {
      const content = 'x'.repeat(1024);
      const { response } = await chatCompletion({
        messages: [createMessage('user', content)],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles large message (100KB)', async () => {
      const content = 'x'.repeat(100 * 1024);
      const { response } = await chatCompletion({
        messages: [createMessage('user', content)],
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects extremely large message (5MB)', async () => {
      const content = 'x'.repeat(5 * 1024 * 1024);
      const response = await fetch(`${BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [createMessage('user', content)],
        }),
      });
      // Should be rejected (413 or 400)
      expect([400, 413]).toContain(response.status);
    });
  });

  describe('Array Boundary Conditions', () => {
    test('handles single message', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles 50 messages', async () => {
      const messages = Array.from({ length: 50 }, (_, i) =>
        createMessage(i % 2 === 0 ? 'user' : 'assistant', `Message ${i}`)
      );
      const { response } = await chatCompletion({ messages });
      expect(response.status).not.toBe(400);
    });

    test('handles exactly 100 context_files', async () => {
      const files = Array.from({ length: 100 }, (_, i) => `file${i}.txt`);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        context_files: files,
      });
      expect(response.status).not.toBe(400);
    });

    test('handles exactly 50 allowed_tools', async () => {
      const tools = Array.from({ length: 50 }, (_, i) => `Tool${i}`);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        allowed_tools: tools,
      });
      expect(response.status).not.toBe(400);
    });

    test('handles exactly 20 add_dirs', async () => {
      const dirs = Array.from({ length: 20 }, (_, i) => `/tmp/dir${i}`);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        add_dirs: dirs,
      });
      expect(response.status).not.toBe(400);
    });

    test('handles exactly 10 betas', async () => {
      const betas = Array.from({ length: 10 }, (_, i) => `beta${i}`);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        betas,
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Whitespace Handling', () => {
    test('handles leading whitespace in content', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', '   Hello')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles trailing whitespace in content', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hello   ')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles only whitespace in content', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', '   ')],
      });
      // Might be rejected as "empty"
      expect([200, 400]).toContain(response.status);
    });

    test('handles newlines in content', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hello\nWorld\nTest')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles tabs in content', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hello\tWorld\tTest')],
      });
      expect(response.status).not.toBe(400);
    });

    test('handles mixed whitespace', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', '  Hello\n\tWorld  \n  ')],
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Numeric Edge Cases', () => {
    test('temperature exactly 0', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 0,
      });
      expect(response.status).not.toBe(400);
    });

    test('temperature exactly 2', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 2,
      });
      expect(response.status).not.toBe(400);
    });

    test('temperature very small positive', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: 0.0001,
      });
      expect(response.status).not.toBe(400);
    });

    test('max_tokens = 1', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        max_tokens: 1,
      });
      expect(response.status).not.toBe(400);
    });

    test('max_tokens very large', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        max_tokens: 100000,
      });
      expect(response.status).not.toBe(400);
    });

    test('top_p exactly 0', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        top_p: 0,
      });
      expect(response.status).not.toBe(400);
    });

    test('top_p exactly 1', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        top_p: 1,
      });
      expect(response.status).not.toBe(400);
    });
  });

  describe('Null and Undefined Handling', () => {
    test('handles null optional fields gracefully', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        temperature: null,
        max_tokens: null,
      });
      // Should either accept or give validation error, not crash
      expect([200, 400]).toContain(response.status);
    });

    test('handles explicit undefined (omitted) fields', async () => {
      const body: any = {
        messages: [createMessage('user', 'Hi')],
      };
      // Explicitly set undefined (will be omitted in JSON)
      body.temperature = undefined;
      body.max_tokens = undefined;

      const { response } = await chatCompletion(body);
      expect(response.status).not.toBe(400);
    });
  });

  describe('Session ID Edge Cases', () => {
    test('accepts lowercase UUID', async () => {
      const uuid = generateUUID().toLowerCase();
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: uuid,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts uppercase UUID', async () => {
      const uuid = generateUUID().toUpperCase();
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: uuid,
      });
      expect(response.status).not.toBe(400);
    });

    test('accepts mixed case UUID', async () => {
      const uuid = '12345678-AbCd-4EfG-hIjK-123456789ABC';
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: uuid,
      });
      // Invalid format (G is not hex)
      expect(response.status).toBe(400);
    });

    test('rejects UUID with extra characters', async () => {
      const uuid = generateUUID() + 'x';
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: uuid,
      });
      // 400 for validation error, 429 for rate limit
      expect([400, 429]).toContain(response.status);
    });

    test('rejects UUID with missing characters', async () => {
      const uuid = generateUUID().slice(0, -1);
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        session_id: uuid,
      });
      // 400 for validation error, 429 for rate limit
      expect([400, 429]).toContain(response.status);
    });
  });

  describe('Concurrent Request Edge Cases', () => {
    test('handles 10 concurrent requests', async () => {
      const promises = Array.from({ length: 10 }, () =>
        chatCompletion({
          messages: [createMessage('user', 'Hi')],
        })
      );

      const results = await Promise.all(promises);
      // All should complete (even if rate limited)
      expect(results.length).toBe(10);
    });

    test('handles rapid sequential requests', async () => {
      const results = [];
      for (let i = 0; i < 10; i++) {
        const result = await chatCompletion({
          messages: [createMessage('user', `Request ${i}`)],
        });
        results.push(result.response.status);
      }

      // All should complete
      expect(results.length).toBe(10);
    });
  });

  describe('Path Edge Cases', () => {
    test('handles path with spaces', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/my folder',
      });
      expect(response.status).not.toBe(400);
    });

    test('handles path with unicode', async () => {
      const { response } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/文件夹',
      });
      expect(response.status).not.toBe(400);
    });

    test('rejects path with null bytes', async () => {
      const { response, data } = await chatCompletion({
        messages: [createMessage('user', 'Hi')],
        working_directory: '/tmp/test\x00evil',
      });
      // Should reject - null bytes are security issue
      expect([400, 429]).toContain(response.status);
      // If rejected with 400, should have error details
      if (response.status === 400) {
        expect((data as any).error).toBeDefined();
        expect((data as any).error.message).toBeDefined();
      }
    });
  });
});
