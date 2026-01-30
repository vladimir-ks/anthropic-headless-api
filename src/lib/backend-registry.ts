/**
 * Backend Registry
 *
 * Loads backend configurations from backends.json and instantiates adapters.
 * Provides centralized access to all available backends.
 */

import { readFileSync } from 'fs';
import { resolve, isAbsolute } from 'path';
import type { BackendAdapter, BackendConfig } from './backends/base-adapter';
import { ClaudeCLIAdapter } from './backends/claude-cli-adapter';
import { OpenRouterAdapter } from './backends/openrouter-adapter';
import { AnthropicAPIAdapter } from './backends/anthropic-api-adapter';
import { OpenAIAdapter } from './backends/openai-adapter';
import { GeminiAdapter } from './backends/gemini-adapter';

interface BackendsConfig {
  backends: BackendConfig[];
  routing: {
    defaultBackend: string;
    preferCheapest: boolean;
    fallbackChain: string[];
  };
}

export class BackendRegistry {
  private backends: Map<string, BackendAdapter> = new Map();
  private config: BackendsConfig;

  constructor(configPath: string) {
    // Validate config path to prevent path traversal
    const resolvedPath = resolve(configPath);
    if (!isAbsolute(resolvedPath)) {
      throw new Error('Config path must resolve to absolute path');
    }
    // Block system directories
    const blocked = ['/etc', '/var', '/usr', '/bin', '/sbin', '/root', '/proc', '/sys'];
    if (blocked.some((dir) => resolvedPath.startsWith(dir))) {
      throw new Error(`Config path blocked: ${resolvedPath}`);
    }

    // Load configuration
    const configContent = readFileSync(resolvedPath, 'utf-8');
    this.config = JSON.parse(configContent) as BackendsConfig;

    // Instantiate backends
    for (const backendConfig of this.config.backends) {
      try {
        const adapter = this.createAdapter(backendConfig);
        this.backends.set(backendConfig.name, adapter);
        console.log(`[BackendRegistry] Registered backend: ${backendConfig.name} (${backendConfig.type})`);
      } catch (error) {
        console.error(
          `[BackendRegistry] Failed to register backend ${backendConfig.name}:`,
          error instanceof Error ? error.message : error
        );
      }
    }

    if (this.backends.size === 0) {
      throw new Error('No backends successfully registered');
    }
  }

  /**
   * Create adapter instance based on backend configuration
   */
  private createAdapter(config: BackendConfig): BackendAdapter {
    if (config.type === 'claude-cli') {
      return new ClaudeCLIAdapter(config);
    }

    // API backends
    switch (config.provider) {
      case 'openrouter':
        return new OpenRouterAdapter(config);
      case 'anthropic':
        return new AnthropicAPIAdapter(config);
      case 'openai':
        return new OpenAIAdapter(config);
      case 'google':
        return new GeminiAdapter(config);
      default:
        throw new Error(`Unknown backend provider: ${config.provider}`);
    }
  }

  /**
   * Get backend by name
   */
  getBackend(name: string): BackendAdapter | undefined {
    return this.backends.get(name);
  }

  /**
   * Get all registered backends
   */
  getAllBackends(): BackendAdapter[] {
    return Array.from(this.backends.values());
  }

  /**
   * Get backends that support tools (Claude CLI)
   */
  getToolBackends(): BackendAdapter[] {
    return this.getAllBackends().filter((b) => b.supportsTools);
  }

  /**
   * Get backends that don't support tools (API pass-through)
   */
  getAPIBackends(): BackendAdapter[] {
    return this.getAllBackends().filter((b) => !b.supportsTools);
  }

  /**
   * Get default backend
   */
  getDefaultBackend(): BackendAdapter | undefined {
    return this.backends.get(this.config.routing.defaultBackend);
  }

  /**
   * Get fallback chain
   */
  getFallbackChain(): BackendAdapter[] {
    return this.config.routing.fallbackChain
      .map((name) => this.backends.get(name))
      .filter((b): b is BackendAdapter => b !== undefined);
  }

  /**
   * Get routing configuration
   */
  getRoutingConfig() {
    return this.config.routing;
  }

  /**
   * Check if all backends are healthy (parallel health checks)
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();

    const checks = Array.from(this.backends.entries()).map(
      async ([name, backend]) => {
        try {
          const isAvailable = await backend.isAvailable();
          results.set(name, isAvailable);
        } catch {
          results.set(name, false);
        }
      }
    );

    await Promise.all(checks);

    return results;
  }
}
