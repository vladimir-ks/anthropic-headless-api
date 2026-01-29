/**
 * OpenRouter API Backend Adapter
 *
 * OpenRouter is OpenAI-compatible, so minimal transformation is needed.
 * Handles cost-effective API pass-through for simple chat requests without tools.
 */

import { BaseAdapter, type BackendConfig } from './base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';

export class OpenRouterAdapter extends BaseAdapter {
  private apiKey: string;

  constructor(config: BackendConfig) {
    super(config);

    if (config.type !== 'api' || config.provider !== 'openrouter') {
      throw new Error(`OpenRouterAdapter requires type='api' and provider='openrouter'`);
    }

    if (!config.authTokenEnv) {
      throw new Error(`OpenRouterAdapter requires authTokenEnv`);
    }

    if (!config.baseUrl) {
      throw new Error(`OpenRouterAdapter requires baseUrl`);
    }

    if (!config.model) {
      throw new Error(`OpenRouterAdapter requires model`);
    }

    // Fetch API key from environment
    const apiKey = process.env[config.authTokenEnv];
    if (!apiKey) {
      throw new Error(
        `OpenRouterAdapter: Environment variable ${config.authTokenEnv} not set`
      );
    }

    this.apiKey = apiKey;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Build OpenAI-compatible request body
    const body = {
      model: this.config.model!,
      messages: request.messages,
      stream: false, // For now, handle streaming separately
      max_tokens: request.max_tokens,
      temperature: request.temperature,
      top_p: request.top_p,
    };

    // Make API request with timeout
    const url = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://github.com/anthropic/headless-api', // Optional: for OpenRouter stats
          'X-Title': 'Anthropic Headless API Gateway', // Optional: for OpenRouter stats
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('OpenRouter API request timeout (60s)');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `OpenRouter API error (${response.status}): ${errorText.slice(0, 500)}`
      );
    }

    let data: ChatCompletionResponse;
    try {
      data = (await response.json()) as ChatCompletionResponse;
    } catch (parseError) {
      throw new Error(
        `Failed to parse OpenRouter API response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`
      );
    }

    // OpenRouter responses are already OpenAI-compatible
    return data;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Simple health check: try to fetch models endpoint
      const url = `${this.config.baseUrl}/models`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        return response.ok;
      } catch {
        clearTimeout(timeout);
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Estimate cost based on token count and per-token pricing
   */
  estimateCost(request: ChatCompletionRequest): number {
    // Use estimated token count for more accurate cost prediction
    const estimatedTokens = this.estimateTokens(request.messages);

    // OpenRouter costs vary by model, but we use config's per-request cost as baseline
    // For better accuracy, multiply by estimated tokens (assuming cost is per-1K tokens)
    const tokensInThousands = estimatedTokens / 1000;
    return this.config.costPerRequest * tokensInThousands;
  }
}
