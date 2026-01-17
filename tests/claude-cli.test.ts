/**
 * Claude CLI utility tests
 *
 * Tests for buildPromptWithHistory and related functions
 */

import { describe, test, expect } from 'bun:test';
import { buildPromptWithHistory } from '../src/lib/claude-cli';

describe('buildPromptWithHistory', () => {
  test('returns last user message when resuming session', () => {
    const messages = [
      { role: 'user', content: 'First message' },
      { role: 'assistant', content: 'First response' },
      { role: 'user', content: 'Second message' },
    ];

    const result = buildPromptWithHistory(messages, true);

    expect(result).toBe('Second message');
  });

  test('throws error when resuming session with no user messages', () => {
    const messages = [
      { role: 'system', content: 'You are helpful' },
      { role: 'assistant', content: 'Hello' },
    ];

    expect(() => buildPromptWithHistory(messages, true)).toThrow(
      'Cannot resume session: no user messages found in conversation'
    );
  });

  test('throws error when resuming session with empty messages array', () => {
    const messages: Array<{ role: string; content: string }> = [];

    expect(() => buildPromptWithHistory(messages, true)).toThrow(
      'Cannot resume session: no user messages found in conversation'
    );
  });

  test('builds full prompt for new session with single message', () => {
    const messages = [{ role: 'user', content: 'Hello' }];

    const result = buildPromptWithHistory(messages, false);

    expect(result).toBe('Hello');
  });

  test('builds full prompt with conversation history', () => {
    const messages = [
      { role: 'user', content: 'First' },
      { role: 'assistant', content: 'Response1' },
      { role: 'user', content: 'Second' },
    ];

    const result = buildPromptWithHistory(messages, false);

    expect(result).toContain('--- CONVERSATION HISTORY ---');
    expect(result).toContain('User: First');
    expect(result).toContain('Assistant: Response1');
    expect(result).toContain('--- END HISTORY ---');
    expect(result).toContain('Current query:');
    expect(result).toContain('Second');
  });

  test('filters out system messages from conversation history', () => {
    const messages = [
      { role: 'system', content: 'System prompt' },
      { role: 'user', content: 'User message' },
      { role: 'assistant', content: 'Response' },
      { role: 'user', content: 'Follow-up' },
    ];

    const result = buildPromptWithHistory(messages, false);

    expect(result).not.toContain('System prompt');
    expect(result).toContain('User: User message');
    expect(result).toContain('Assistant: Response');
  });

  test('handles session with only system messages by throwing error', () => {
    const messages = [
      { role: 'system', content: 'System1' },
      { role: 'system', content: 'System2' },
    ];

    // For new session, should return empty string (no conversation messages)
    const result = buildPromptWithHistory(messages, false);
    expect(result).toBe('');

    // For resumed session, should throw
    expect(() => buildPromptWithHistory(messages, true)).toThrow(
      'Cannot resume session: no user messages found in conversation'
    );
  });

  test('returns last user message even when followed by assistant messages', () => {
    const messages = [
      { role: 'user', content: 'Question' },
      { role: 'assistant', content: 'Answer1' },
      { role: 'assistant', content: 'Answer2' },
    ];

    const result = buildPromptWithHistory(messages, true);

    expect(result).toBe('Question');
  });
});
