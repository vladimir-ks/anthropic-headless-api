/**
 * Claude CLI Backend Adapter
 *
 * Wraps the existing claude-cli.ts functionality to implement the BackendAdapter interface.
 * Handles local Claude Code CLI execution with tool support.
 */

import { BaseAdapter, type BackendConfig } from './base-adapter';
import type { ChatCompletionRequest, ChatCompletionResponse } from '../../types/api';
import { executeClaudeQuery, checkClaudeAvailable, buildPromptWithHistory } from '../claude-cli';
import type { ClaudeExecuteOptions } from '../../types/claude';

export class ClaudeCLIAdapter extends BaseAdapter {
  constructor(config: BackendConfig) {
    super(config);

    if (config.type !== 'claude-cli') {
      throw new Error(`ClaudeCLIAdapter requires type='claude-cli', got '${config.type}'`);
    }

    if (!config.configDir) {
      throw new Error(`ClaudeCLIAdapter requires configDir`);
    }
  }

  async execute(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    // Build Claude CLI options from OpenAI-compatible request
    const hasSessionId = Boolean(request.session_id);
    const query = buildPromptWithHistory(request.messages, hasSessionId);

    const options: ClaudeExecuteOptions = {
      query,
      configDir: this.config.configDir!,
      workingDirectory: request.working_directory,
      model: request.model,
      systemPrompt: request.system_prompt,
      sessionId: request.session_id,
      tools: request.tools,
      timeout: this.config.timeout || 120000,
    };

    // Execute via Claude CLI
    const result = await executeClaudeQuery(options);

    if (!result.success) {
      throw new Error(result.error || 'Claude CLI execution failed');
    }

    // Transform to OpenAI-compatible response
    const response: ChatCompletionResponse = {
      id: result.metadata?.uuid || `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model || 'claude-3-5-sonnet-20241022',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: result.output,
          },
          finish_reason: 'stop',
        },
      ],
      usage: result.metadata?.usage
        ? {
            prompt_tokens: result.metadata.usage.inputTokens,
            completion_tokens: result.metadata.usage.outputTokens,
            total_tokens:
              result.metadata.usage.inputTokens + result.metadata.usage.outputTokens,
          }
        : {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
      session_id: result.sessionId || undefined,
    };

    return response;
  }

  async isAvailable(): Promise<boolean> {
    try {
      return await checkClaudeAvailable();
    } catch {
      return false;
    }
  }

  /**
   * Estimate cost based on token usage (if available) or fall back to config
   */
  estimateCost(request: ChatCompletionRequest): number {
    // For Claude CLI, cost is typically included in subscription
    // Return configured cost (usually 0.0)
    return this.config.costPerRequest;
  }
}
