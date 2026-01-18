/**
 * Base adapter interface for all backends (Claude CLI, API providers)
 *
 * This interface defines the contract that all backend adapters must implement,
 * enabling the gateway to route requests to different backends transparently.
 */

import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';

/**
 * Backend configuration from backends.json
 */
export interface BackendConfig {
  name: string;
  type: 'claude-cli' | 'api';

  // Claude CLI specific
  configDir?: string;
  maxConcurrent?: number;
  queueSize?: number;
  timeout?: number;

  // API specific
  provider?: string;
  baseUrl?: string;
  model?: string;
  authTokenEnv?: string;
  maxTokens?: number;

  // Common
  costPerRequest: number;
  supportsTools: boolean;
  description?: string;
}

/**
 * Base interface for all backend adapters
 */
export interface BackendAdapter {
  /**
   * Backend name (unique identifier)
   */
  readonly name: string;

  /**
   * Backend type (claude-cli or api)
   */
  readonly type: 'claude-cli' | 'api';

  /**
   * Whether this backend supports tool use (Read, Write, Bash)
   */
  readonly supportsTools: boolean;

  /**
   * Execute a chat completion request
   * @param request - OpenAI-compatible request
   * @returns OpenAI-compatible response
   */
  execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;

  /**
   * Estimate cost for a request (in USD)
   * @param request - Request to estimate
   * @returns Estimated cost in USD
   */
  estimateCost(request: ChatCompletionRequest): number;

  /**
   * Check if backend is available and healthy
   * @returns Promise resolving to availability status
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get backend configuration
   */
  getConfig(): BackendConfig;
}

/**
 * Abstract base class implementing common adapter functionality
 */
export abstract class BaseAdapter implements BackendAdapter {
  constructor(protected config: BackendConfig) {}

  get name(): string {
    return this.config.name;
  }

  get type(): 'claude-cli' | 'api' {
    return this.config.type;
  }

  get supportsTools(): boolean {
    return this.config.supportsTools;
  }

  getConfig(): BackendConfig {
    return this.config;
  }

  /**
   * Estimate token count from messages (rough approximation)
   */
  protected estimateTokens(messages: Array<{ role: string; content: string }>): number {
    const totalChars = messages.reduce((sum, msg) => sum + msg.content.length, 0);
    // Rough estimate: ~4 chars per token
    return Math.ceil(totalChars / 4);
  }

  /**
   * Default cost estimation based on config
   */
  estimateCost(request: ChatCompletionRequest): number {
    return this.config.costPerRequest;
  }

  abstract execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
  abstract isAvailable(): Promise<boolean>;
}
