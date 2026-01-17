/**
 * Validation schema tests
 *
 * Tests Zod schemas for request validation.
 */

import { describe, test, expect } from 'bun:test';
import {
  validateChatCompletionRequest,
  ChatMessageSchema,
  ChatCompletionRequestSchema,
} from '../src/validation/schemas';

describe('ChatMessageSchema', () => {
  test('accepts valid user message', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'user',
      content: 'Hello',
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid assistant message', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'assistant',
      content: 'Hi there!',
    });
    expect(result.success).toBe(true);
  });

  test('accepts valid system message', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'system',
      content: 'You are helpful.',
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid role', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'invalid',
      content: 'Hello',
    });
    expect(result.success).toBe(false);
  });

  test('rejects empty content', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'user',
      content: '',
    });
    expect(result.success).toBe(false);
  });

  test('rejects missing content', () => {
    const result = ChatMessageSchema.safeParse({
      role: 'user',
    });
    expect(result.success).toBe(false);
  });
});

describe('ChatCompletionRequestSchema', () => {
  test('accepts minimal valid request', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
  });

  test('accepts request with all optional fields', () => {
    const result = validateChatCompletionRequest({
      model: 'opus',
      messages: [{ role: 'user', content: 'Hello' }],
      max_tokens: 100,
      temperature: 0.7,
      stream: true,
      // Valid UUID v4 format
      session_id: 'a1234567-b123-4123-8123-c12345678901',
    });
    expect(result.success).toBe(true);
  });

  test('rejects empty messages array', () => {
    const result = validateChatCompletionRequest({
      messages: [],
    });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.message).toContain('empty');
  });

  test('rejects messages without user role', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'system', content: 'You are helpful.' }],
    });
    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.message).toContain('user');
  });

  test('rejects temperature out of range (too high)', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: 3,
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative temperature', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      temperature: -0.5,
    });
    expect(result.success).toBe(false);
  });

  test('rejects non-positive max_tokens', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 0,
    });
    expect(result.success).toBe(false);
  });

  test('rejects negative max_tokens', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: -10,
    });
    expect(result.success).toBe(false);
  });

  test('rejects invalid session_id format', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      session_id: 'not-a-uuid',
    });
    expect(result.success).toBe(false);
  });

  test('accepts valid UUID session_id', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      session_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    });
    expect(result.success).toBe(true);
  });

  test('accepts allowed_tools array', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      allowed_tools: ['Read', 'Grep', 'Glob'],
    });
    expect(result.success).toBe(true);
  });

  test('accepts permission_mode values', () => {
    const modes = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];
    for (const mode of modes) {
      const result = validateChatCompletionRequest({
        messages: [{ role: 'user', content: 'Hi' }],
        permission_mode: mode,
      });
      expect(result.success).toBe(true);
    }
  });

  test('rejects invalid permission_mode', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      permission_mode: 'invalid_mode',
    });
    expect(result.success).toBe(false);
  });
});

describe('Tool control validation', () => {
  test('accepts tools as empty string (disable all)', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: '',
    });
    expect(result.success).toBe(true);
  });

  test('accepts tools as "default"', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: 'default',
    });
    expect(result.success).toBe(true);
  });

  test('accepts tools as array', () => {
    const result = validateChatCompletionRequest({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: ['Read', 'Write'],
    });
    expect(result.success).toBe(true);
  });
});
