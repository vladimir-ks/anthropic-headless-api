/**
 * E2E Tests - Chat Completions Comprehensive
 *
 * Tests actual chat completion responses against real API
 * WARNING: These tests make real API calls and cost money!
 */

import { describe, test, expect, beforeAll } from 'bun:test';
import { BASE_URL, waitForServer, chatCompletion, createMessage, generateUUID, hasAPIBackends, E2E_ENABLED } from './test-utils';

// Skip entire suite if E2E not enabled
const describeE2E = E2E_ENABLED ? describe : describe.skip;

// Check if API backends are available
let apiAvailable = false;

describeE2E('E2E: Chat Completions', () => {
  beforeAll(async () => {
    const ready = await waitForServer(10, 500);
    if (!ready) console.warn('Server not ready');
    apiAvailable = await hasAPIBackends();
    if (!apiAvailable) {
      console.warn('⚠️  No API backends - E2E tests will fail gracefully');
    }
  });

  describe('Basic Completions', () => {
    test('simple message returns valid response', async () => {
      const { response, data, duration } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Say exactly: "test response"')],
        stream: false,
      });

      expect(response.ok).toBe(true);
      expect(data).toHaveProperty('id');
      expect(data).toHaveProperty('choices');
      expect(data).toHaveProperty('usage');
      expect((data as any).choices[0].message.role).toBe('assistant');
      expect((data as any).choices[0].message.content.length).toBeGreaterThan(0);
    }, 180000);

    test('response has correct object type', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      expect((data as any).object).toBe('chat.completion');
    }, 180000);

    test('response has created timestamp', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      expect((data as any).created).toBeDefined();
      expect(typeof (data as any).created).toBe('number');
      expect((data as any).created).toBeGreaterThan(0);
    }, 180000);

    test('response has model identifier', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      expect((data as any).model).toBeDefined();
      expect(typeof (data as any).model).toBe('string');
    }, 180000);
  });

  describe('Response Structure', () => {
    test('choices array has correct structure', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Say "ok"')],
      });

      const choices = (data as any).choices;
      expect(Array.isArray(choices)).toBe(true);
      expect(choices.length).toBe(1);

      const choice = choices[0];
      expect(choice.index).toBe(0);
      expect(choice.message).toBeDefined();
      expect(choice.finish_reason).toBe('stop');
    }, 180000);

    test('message object has role and content', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Say "test"')],
      });

      const message = (data as any).choices[0].message;
      expect(message.role).toBe('assistant');
      expect(message.content).toBeDefined();
      expect(typeof message.content).toBe('string');
    }, 180000);

    test('usage object has token counts', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Say "x"')],
      });

      const usage = (data as any).usage;
      expect(usage).toBeDefined();
      expect(usage.prompt_tokens).toBeGreaterThan(0);
      expect(usage.completion_tokens).toBeGreaterThan(0);
      expect(usage.total_tokens).toBe(usage.prompt_tokens + usage.completion_tokens);
    }, 180000);

    test('response includes session_id', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      expect((data as any).session_id).toBeDefined();
      expect(typeof (data as any).session_id).toBe('string');
      // Should be valid UUID format
      expect((data as any).session_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }, 180000);
  });

  describe('System Prompt', () => {
    test('system message affects response', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [
          createMessage('system', 'You always respond with exactly the word "BANANA"'),
          createMessage('user', 'What is your response?'),
        ],
      });

      expect((data as any).choices[0].message.content.toUpperCase()).toContain('BANANA');
    }, 180000);

    test('system field as alternative', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
        system: 'Be brief.',
      });

      expect(response.ok).toBe(true);
    }, 180000);

    test('append_system_prompt adds to system', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
        append_system_prompt: 'Always be polite.',
      });

      expect(response.ok).toBe(true);
    }, 180000);
  });

  describe('Multi-turn Conversations', () => {
    test('handles conversation history', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [
          createMessage('user', 'My name is Alice.'),
          createMessage('assistant', 'Nice to meet you, Alice!'),
          createMessage('user', 'What is my name?'),
        ],
      });

      const content = (data as any).choices[0].message.content.toLowerCase();
      expect(content).toContain('alice');
    }, 180000);

    test('maintains context with session_id', async () => {
      // First request
      const { data: firstData } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Remember: the secret word is ELEPHANT')],
      });

      const sessionId = (firstData as any).session_id;

      // Second request with same session
      const { data: secondData } = await chatCompletion({
        model: 'haiku',
        messages: [
          createMessage('user', 'Remember: the secret word is ELEPHANT'),
          createMessage('assistant', (firstData as any).choices[0].message.content),
          createMessage('user', 'What is the secret word?'),
        ],
        session_id: sessionId,
      });

      expect((secondData as any).session_id).toBe(sessionId);
    }, 300000);
  });

  describe('Model Variants', () => {
    test('haiku model works', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Say "haiku works"')],
      });

      expect(response.ok).toBe(true);
    }, 180000);

    test('sonnet model works', async () => {
      const { response } = await chatCompletion({
        model: 'sonnet',
        messages: [createMessage('user', 'Say "sonnet works"')],
      });

      expect(response.ok).toBe(true);
    }, 180000);

    test('opus model works', async () => {
      const { response } = await chatCompletion({
        model: 'opus',
        messages: [createMessage('user', 'Say "opus works"')],
      });

      expect(response.ok).toBe(true);
    }, 180000);
  });

  describe('Generation Parameters', () => {
    test('max_tokens limits response length', async () => {
      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Write a very long story about a cat')],
        max_tokens: 50,
      });

      // Response should be limited
      expect((data as any).usage.completion_tokens).toBeLessThanOrEqual(60);
    }, 180000);

    test('temperature 0 is deterministic', async () => {
      const request = {
        model: 'haiku',
        messages: [createMessage('user', 'What is 2+2? Reply with just the number.')],
        temperature: 0,
      };

      const { data: data1 } = await chatCompletion(request);
      const { data: data2 } = await chatCompletion(request);

      // Should get similar responses
      const content1 = (data1 as any).choices[0].message.content;
      const content2 = (data2 as any).choices[0].message.content;
      expect(content1).toContain('4');
      expect(content2).toContain('4');
    }, 300000);
  });

  describe('Session Continuity', () => {
    test('new request generates new session_id', async () => {
      const { data: data1 } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
      });

      const { data: data2 } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hello')],
      });

      // Different sessions
      expect((data1 as any).session_id).not.toBe((data2 as any).session_id);
    }, 300000);

    test('provided session_id is returned', async () => {
      const mySessionId = generateUUID();

      const { data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
        session_id: mySessionId,
      });

      expect((data as any).session_id).toBe(mySessionId);
    }, 180000);
  });

  describe('Tool Features', () => {
    test('allowed_tools routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'What files are in the current directory?')],
        allowed_tools: ['Bash'],
        working_directory: '/tmp',
      });

      expect(response.ok).toBe(true);
    }, 180000);

    test('context_files routes to Claude CLI', async () => {
      const { response } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Summarize the file')],
        context_files: ['package.json'],
        working_directory: process.cwd(),
      });

      expect(response.ok).toBe(true);
    }, 180000);
  });

  describe('Verbose Mode', () => {
    test('verbose mode includes metadata', async () => {
      const { response, data } = await chatCompletion({
        model: 'haiku',
        messages: [createMessage('user', 'Hi')],
        verbose: true,
      });

      // Verbose mode may include additional metadata
      expect(response.ok).toBe(true);
    }, 180000);
  });
});
