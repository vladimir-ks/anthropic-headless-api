/**
 * Backend Adapters Unit Tests
 *
 * Tests request/response transformation, error handling, and API-specific logic
 * for all backend adapter implementations.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import type { ChatCompletionRequest } from '../../src/types/api';

// Mock fetch globally for API adapter tests
const mockFetch = mock(() => Promise.resolve(new Response()));
const originalFetch = global.fetch;

describe('Backend Adapters', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('AnthropicAPIAdapter', () => {
    test('transforms OpenAI format to Anthropic format', async () => {
      const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

      process.env.TEST_API_KEY = 'test-key';

      const adapter = new AnthropicAPIAdapter({
        name: 'test-anthropic',
        type: 'api',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        baseUrl: 'https://api.anthropic.com/v1',
        authTokenEnv: 'TEST_API_KEY',
        costPerRequest: 0.01,
        supportsTools: false,
      });

      // Mock successful response
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello!' }],
        model: 'claude-3-haiku-20240307',
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }), { status: 200 })));

      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 100,
      };

      const response = await adapter.execute(request);

      expect(response.object).toBe('chat.completion');
      expect(response.choices[0].message.role).toBe('assistant');
      expect(response.choices[0].message.content).toBe('Hello!');
    });

    test('handles API errors gracefully', async () => {
      const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

      process.env.TEST_API_KEY = 'test-key';

      const adapter = new AnthropicAPIAdapter({
        name: 'test-anthropic',
        type: 'api',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        baseUrl: 'https://api.anthropic.com/v1',
        authTokenEnv: 'TEST_API_KEY',
        costPerRequest: 0.01,
        supportsTools: false,
      });

      // Mock error response
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(
        JSON.stringify({ error: { message: 'Rate limit exceeded' } }),
        { status: 429 }
      )));

      await expect(adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('Anthropic API error');
    });

    test('estimates cost based on token count', async () => {
      const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

      process.env.TEST_API_KEY = 'test-key';

      const adapter = new AnthropicAPIAdapter({
        name: 'test-anthropic',
        type: 'api',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        baseUrl: 'https://api.anthropic.com/v1',
        authTokenEnv: 'TEST_API_KEY',
        costPerRequest: 0.01,
        supportsTools: false,
      });

      const cost = adapter.estimateCost({
        messages: [{ role: 'user', content: 'Hello world' }],
      });

      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });

    test('rejects invalid config', async () => {
      const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

      expect(() => new AnthropicAPIAdapter({
        name: 'test',
        type: 'api',
        provider: 'openai', // Wrong provider
        costPerRequest: 0.01,
        supportsTools: false,
      })).toThrow();
    });
  });

  describe('OpenAIAdapter', () => {
    test('sends correct request format', async () => {
      const { OpenAIAdapter } = await import('../../src/lib/backends/openai-adapter');

      process.env.OPENAI_API_KEY = 'test-key';

      const adapter = new OpenAIAdapter({
        name: 'test-openai',
        type: 'api',
        provider: 'openai',
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com/v1',
        authTokenEnv: 'OPENAI_API_KEY',
        costPerRequest: 0.03,
        supportsTools: false,
      });

      // Mock successful response
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'gpt-4',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'Response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200 })));

      const response = await adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.choices[0].message.content).toBe('Response');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('handles timeout errors', async () => {
      const { OpenAIAdapter } = await import('../../src/lib/backends/openai-adapter');

      process.env.OPENAI_API_KEY = 'test-key';

      const adapter = new OpenAIAdapter({
        name: 'test-openai',
        type: 'api',
        provider: 'openai',
        model: 'gpt-4',
        baseUrl: 'https://api.openai.com/v1',
        authTokenEnv: 'OPENAI_API_KEY',
        costPerRequest: 0.03,
        supportsTools: false,
      });

      // Mock abort error
      mockFetch.mockImplementationOnce(() => {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      await expect(adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('timeout');
    });
  });

  describe('GeminiAdapter', () => {
    test('transforms messages to Gemini format', async () => {
      const { GeminiAdapter } = await import('../../src/lib/backends/gemini-adapter');

      process.env.GEMINI_API_KEY = 'test-key';

      const adapter = new GeminiAdapter({
        name: 'test-gemini',
        type: 'api',
        provider: 'google',
        model: 'gemini-1.5-pro',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        authTokenEnv: 'GEMINI_API_KEY',
        costPerRequest: 0.0125,
        supportsTools: false,
      });

      // Mock successful response
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text: 'Gemini response' }], role: 'model' },
          finishReason: 'STOP',
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 5,
          totalTokenCount: 15,
        },
      }), { status: 200 })));

      const response = await adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      expect(response.choices[0].message.content).toBe('Gemini response');
      expect(response.choices[0].finish_reason).toBe('stop');
    });

    test('handles empty candidates array', async () => {
      const { GeminiAdapter } = await import('../../src/lib/backends/gemini-adapter');

      process.env.GEMINI_API_KEY = 'test-key';

      const adapter = new GeminiAdapter({
        name: 'test-gemini',
        type: 'api',
        provider: 'google',
        model: 'gemini-1.5-pro',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        authTokenEnv: 'GEMINI_API_KEY',
        costPerRequest: 0.0125,
        supportsTools: false,
      });

      // Mock response with no candidates
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        candidates: [],
      }), { status: 200 })));

      await expect(adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('no candidates');
    });

    test('handles candidate with missing content structure', async () => {
      const { GeminiAdapter } = await import('../../src/lib/backends/gemini-adapter');

      process.env.GEMINI_API_KEY = 'test-key';

      const adapter = new GeminiAdapter({
        name: 'test-gemini',
        type: 'api',
        provider: 'google',
        model: 'gemini-1.5-pro',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        authTokenEnv: 'GEMINI_API_KEY',
        costPerRequest: 0.0125,
        supportsTools: false,
      });

      // Mock response with candidate missing content
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        candidates: [{ finishReason: 'STOP' }],
      }), { status: 200 })));

      await expect(adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      })).rejects.toThrow('missing content');
    });
  });

  describe('OpenRouterAdapter', () => {
    test('includes OpenRouter-specific headers', async () => {
      const { OpenRouterAdapter } = await import('../../src/lib/backends/openrouter-adapter');

      process.env.OPENROUTER_API_KEY = 'test-key';

      const adapter = new OpenRouterAdapter({
        name: 'test-openrouter',
        type: 'api',
        provider: 'openrouter',
        model: 'anthropic/claude-3-haiku',
        baseUrl: 'https://openrouter.ai/api/v1',
        authTokenEnv: 'OPENROUTER_API_KEY',
        costPerRequest: 0.00025,
        supportsTools: false,
      });

      // Mock successful response
      mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({
        id: 'gen-123',
        object: 'chat.completion',
        created: Date.now(),
        model: 'anthropic/claude-3-haiku',
        choices: [{
          index: 0,
          message: { role: 'assistant', content: 'OpenRouter response' },
          finish_reason: 'stop',
        }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }), { status: 200 })));

      await adapter.execute({
        messages: [{ role: 'user', content: 'Hi' }],
      });

      // Verify custom headers were sent
      const callArgs = (mockFetch.mock.calls as any[])[0];
      const headers = callArgs[1].headers;
      expect(headers['HTTP-Referer']).toBeDefined();
      expect(headers['X-Title']).toBeDefined();
    });
  });

  describe('BaseAdapter', () => {
    test('provides common functionality', async () => {
      const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

      process.env.TEST_API_KEY = 'test-key';

      const adapter = new AnthropicAPIAdapter({
        name: 'test-base',
        type: 'api',
        provider: 'anthropic',
        model: 'claude-3-haiku-20240307',
        baseUrl: 'https://api.anthropic.com/v1',
        authTokenEnv: 'TEST_API_KEY',
        costPerRequest: 0.01,
        supportsTools: false,
      });

      // Test getConfig
      const config = adapter.getConfig();
      expect(config.name).toBe('test-base');
      expect(config.type).toBe('api');

      // Test name property
      expect(adapter.name).toBe('test-base');

      // Test type property
      expect(adapter.type).toBe('api');

      // Test supportsTools
      expect(adapter.supportsTools).toBe(false);
    });
  });
});

describe('Adapter Error Handling', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('handles network failures', async () => {
    const { OpenAIAdapter } = await import('../../src/lib/backends/openai-adapter');

    process.env.OPENAI_API_KEY = 'test-key';

    const adapter = new OpenAIAdapter({
      name: 'test-openai',
      type: 'api',
      provider: 'openai',
      model: 'gpt-4',
      baseUrl: 'https://api.openai.com/v1',
      authTokenEnv: 'OPENAI_API_KEY',
      costPerRequest: 0.03,
      supportsTools: false,
    });

    // Mock network error
    mockFetch.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

    await expect(adapter.execute({
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow();
  });

  test('handles malformed JSON response', async () => {
    const { AnthropicAPIAdapter } = await import('../../src/lib/backends/anthropic-api-adapter');

    process.env.TEST_API_KEY = 'test-key';

    const adapter = new AnthropicAPIAdapter({
      name: 'test-anthropic',
      type: 'api',
      provider: 'anthropic',
      model: 'claude-3-haiku-20240307',
      baseUrl: 'https://api.anthropic.com/v1',
      authTokenEnv: 'TEST_API_KEY',
      costPerRequest: 0.01,
      supportsTools: false,
    });

    // Mock invalid JSON response
    mockFetch.mockImplementationOnce(() => Promise.resolve(new Response(
      'not valid json',
      { status: 200 }
    )));

    await expect(adapter.execute({
      messages: [{ role: 'user', content: 'Hi' }],
    })).rejects.toThrow('parse');
  });
});

describe('Adapter Availability', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test('isAvailable returns true when API key exists', async () => {
    const { OpenAIAdapter } = await import('../../src/lib/backends/openai-adapter');

    process.env.OPENAI_AVAIL_KEY = 'test-key';

    const adapter = new OpenAIAdapter({
      name: 'test-openai',
      type: 'api',
      provider: 'openai',
      model: 'gpt-4',
      baseUrl: 'https://api.openai.com/v1',
      authTokenEnv: 'OPENAI_AVAIL_KEY',
      costPerRequest: 0.03,
      supportsTools: false,
    });

    const available = await adapter.isAvailable();
    expect(available).toBe(true);
  });

  test('constructor throws when API key missing', async () => {
    const { OpenAIAdapter } = await import('../../src/lib/backends/openai-adapter');

    // Ensure key doesn't exist
    delete process.env.MISSING_API_KEY_TEST;

    expect(() => new OpenAIAdapter({
      name: 'test-openai',
      type: 'api',
      provider: 'openai',
      model: 'gpt-4',
      baseUrl: 'https://api.openai.com/v1',
      authTokenEnv: 'MISSING_API_KEY_TEST',
      costPerRequest: 0.03,
      supportsTools: false,
    })).toThrow('not set');
  });
});
