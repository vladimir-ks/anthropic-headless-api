/**
 * Google Gemini API Backend Adapter
 *
 * Transforms between OpenAI format and Google Gemini's native format.
 * Supports long context (up to 2M tokens) for large documents.
 */

import { BaseAdapter, type BackendConfig } from './base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';

interface GeminiContent {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
}

interface GeminiRequest {
  contents: GeminiContent[];
  generationConfig?: {
    temperature?: number;
    topP?: number;
    maxOutputTokens?: number;
  };
}

interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{ text: string }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

export class GeminiAdapter extends BaseAdapter {
  private apiKey: string;

  constructor(config: BackendConfig) {
    super(config);

    if (config.type !== 'api' || config.provider !== 'google') {
      throw new Error(`GeminiAdapter requires type='api' and provider='google'`);
    }

    if (!config.authTokenEnv) {
      throw new Error(`GeminiAdapter requires authTokenEnv`);
    }

    if (!config.baseUrl) {
      throw new Error(`GeminiAdapter requires baseUrl`);
    }

    if (!config.model) {
      throw new Error(`GeminiAdapter requires model`);
    }

    // Fetch API key from environment
    const apiKey = process.env[config.authTokenEnv];
    if (!apiKey) {
      throw new Error(
        `GeminiAdapter: Environment variable ${config.authTokenEnv} not set`
      );
    }

    this.apiKey = apiKey;
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Transform OpenAI format to Gemini format
    const contents: GeminiContent[] = request.messages
      .filter((m) => m.role !== 'system') // Gemini doesn't have system messages
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));

    // Include system message as first user message if present
    const systemMessage = request.messages.find((m) => m.role === 'system');
    if (systemMessage) {
      contents.unshift({
        role: 'user',
        parts: [{ text: `System: ${systemMessage.content}` }],
      });
    }

    const body: GeminiRequest = {
      contents,
      generationConfig: {
        temperature: request.temperature,
        topP: request.top_p,
        maxOutputTokens: request.max_tokens || this.config.maxTokens,
      },
    };

    // Make API request with timeout (API key in header for security)
    const url = `${this.config.baseUrl}/models/${this.config.model}:generateContent`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

    try {
      var response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Gemini API request timeout (60s)');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Gemini API error (${response.status}): ${errorText.slice(0, 500)}`
      );
    }

    let data: GeminiResponse;
    try {
      data = (await response.json()) as GeminiResponse;
    } catch (parseError) {
      throw new Error(
        `Failed to parse Gemini API response: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`
      );
    }

    // Transform Gemini format to OpenAI format
    const firstCandidate = data.candidates[0];
    if (!firstCandidate) {
      throw new Error('Gemini API returned no candidates');
    }

    const openAIResponse: ChatCompletionResponse = {
      id: `chatcmpl-gemini-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: this.config.model!,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: firstCandidate.content.parts[0]?.text || '',
          },
          finish_reason:
            firstCandidate.finishReason === 'STOP' ? 'stop' : 'length',
        },
      ],
      usage: data.usageMetadata
        ? {
            prompt_tokens: data.usageMetadata.promptTokenCount,
            completion_tokens: data.usageMetadata.candidatesTokenCount,
            total_tokens: data.usageMetadata.totalTokenCount,
          }
        : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
    };

    return openAIResponse;
  }

  async isAvailable(): Promise<boolean> {
    try {
      // Health check: try to list models
      const url = `${this.config.baseUrl}/models`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      try {
        const response = await fetch(url, {
          headers: {
            'x-goog-api-key': this.apiKey,
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
   * Estimate cost based on token count and Gemini pricing
   */
  estimateCost(request: ChatCompletionRequest): number {
    const estimatedTokens = this.estimateTokens(request.messages);
    const tokensInThousands = estimatedTokens / 1000;
    return this.config.costPerRequest * tokensInThousands;
  }
}
