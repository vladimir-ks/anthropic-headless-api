/**
 * Anthropic API Backend Adapter
 *
 * Direct Anthropic API access for pass-through requests without Claude CLI tools.
 * Transforms between OpenAI format and Anthropic's native format.
 */

import { BaseAdapter, type BackendConfig } from './base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AnthropicRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  system?: string;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{ type: 'text'; text: string }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicAPIAdapter extends BaseAdapter {
  private apiKey: string;

  constructor(config: BackendConfig) {
    super(config);

    if (config.type !== 'api' || config.provider !== 'anthropic') {
      throw new Error(`AnthropicAPIAdapter requires type='api' and provider='anthropic'`);
    }

    if (!config.authTokenEnv) {
      throw new Error(`AnthropicAPIAdapter requires authTokenEnv`);
    }

    if (!config.baseUrl) {
      throw new Error(`AnthropicAPIAdapter requires baseUrl`);
    }

    if (!config.model) {
      throw new Error(`AnthropicAPIAdapter requires model`);
    }

    // Fetch API key from environment
    const apiKey = process.env[config.authTokenEnv];
    if (!apiKey) {
      throw new Error(
        `AnthropicAPIAdapter: Environment variable ${config.authTokenEnv} not set`
      );
    }

    this.apiKey = apiKey;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Transform OpenAI format to Anthropic format
    const systemMessage = request.messages.find((m) => m.role === 'system');
    const conversationMessages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const body: AnthropicRequest = {
      model: this.config.model!,
      messages: conversationMessages,
      max_tokens: request.max_tokens || 4096,
      temperature: request.temperature,
      top_p: request.top_p,
    };

    if (systemMessage) {
      body.system = systemMessage.content;
    }

    // Make API request with timeout
    const url = `${this.config.baseUrl}/messages`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Anthropic API request timeout (60s)');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Anthropic API error (${response.status}): ${errorText.slice(0, 500)}`
      );
    }

    let data: AnthropicResponse;
    try {
      data = (await response.json()) as AnthropicResponse;
    } catch (parseError) {
      throw new Error(
        `Failed to parse Anthropic API response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`
      );
    }

    // Transform Anthropic format to OpenAI format
    const openAIResponse: ChatCompletionResponse = {
      id: data.id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: data.model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: data.content[0]?.text || '',
          },
          finish_reason: data.stop_reason === 'end_turn' ? 'stop' : 'length',
        },
      ],
      usage: {
        prompt_tokens: data.usage.input_tokens,
        completion_tokens: data.usage.output_tokens,
        total_tokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };

    return openAIResponse;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Health check: verify API key is valid
      const url = `${this.config.baseUrl}/messages`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout for health check

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model!,
            messages: [{ role: 'user', content: 'test' }],
            max_tokens: 1,
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);
        // Only 200 indicates backend is available and healthy
        return response.status === 200;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Estimate cost based on token count and Anthropic pricing
   */
  estimateCost(request: ChatCompletionRequest): number {
    const estimatedTokens = this.estimateTokens(request.messages);
    const tokensInThousands = estimatedTokens / 1000;
    return this.config.costPerRequest * tokensInThousands;
  }
}
