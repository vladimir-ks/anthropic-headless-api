/**
 * OpenAI API Backend Adapter
 *
 * Simple pass-through to OpenAI API with minimal transformation.
 * Supports GPT-4 and other OpenAI models.
 */

import { BaseAdapter, type BackendConfig } from './base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';

export class OpenAIAdapter extends BaseAdapter {
  private apiKey: string;

  constructor(config: BackendConfig) {
    super(config);

    if (config.type !== 'api' || config.provider !== 'openai') {
      throw new Error(`OpenAIAdapter requires type='api' and provider='openai'`);
    }

    if (!config.authTokenEnv) {
      throw new Error(`OpenAIAdapter requires authTokenEnv`);
    }

    if (!config.baseUrl) {
      throw new Error(`OpenAIAdapter requires baseUrl`);
    }

    if (!config.model) {
      throw new Error(`OpenAIAdapter requires model`);
    }

    // Fetch API key from environment
    const apiKey = process.env[config.authTokenEnv];
    if (!apiKey) {
      throw new Error(
        `OpenAIAdapter: Environment variable ${config.authTokenEnv} not set`
      );
    }

    this.apiKey = apiKey;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // OpenAI API is already in the right format, minimal transformation needed
    const body = {
      model: this.config.model!,
      messages: request.messages,
      stream: false,
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
    };

    // Make API request
    const url = `${this.config.baseUrl}/chat/completions`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenAI API error (${response.status}): ${errorText}`
      );
    }

    const data = (await response.json()) as ChatCompletionResponse;

    return data;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple health check: try to fetch models endpoint
      const url = `${this.config.baseUrl}/models`;
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Estimate cost based on token count and OpenAI pricing
   */
  estimateCost(request: ChatCompletionRequest): number {
    const estimatedTokens = this.estimateTokens(request.messages);
    const tokensInThousands = estimatedTokens / 1000;
    return this.config.costPerRequest * tokensInThousands;
  }
}
