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

    // Load configuration with proper error handling
    let configContent: string;
    try {
      configContent = readFileSync(resolvedPath, 'utf-8');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to read config file ${resolvedPath}: ${message}`);
    }

    try {
      this.config = JSON.parse(configContent) as BackendsConfig;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse config JSON from ${resolvedPath}: ${message}`);
    }

    // Validate config structure
    if (!this.config.backends || !Array.isArray(this.config.backends)) {
      throw new Error(`Invalid config: 'backends' must be an array in ${resolvedPath}`);
    }
    if (!this.config.routing || typeof this.config.routing !== 'object') {
      throw new Error(`Invalid config: 'routing' object required in ${resolvedPath}`);
    }
    if (!this.config.routing.defaultBackend) {
      throw new Error(`Invalid config: 'routing.defaultBackend' required in ${resolvedPath}`);
    }

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
   * Uses Promise.allSettled to ensure one failing check doesn't break others
   */
  async healthCheck(): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const entries = Array.from(this.backends.entries());

    const checks = entries.map(async ([name, backend]) => {
      try {
        const isAvailable = await backend.isAvailable();
        return { name, isAvailable, error: null };
      } catch (error) {
        return { name, isAvailable: false, error };
      }
    });

    // Use allSettled to handle partial failures gracefully
    const settled = await Promise.allSettled(checks);

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        const { name, isAvailable, error } = result.value;
        results.set(name, isAvailable);
        if (error) {
          console.warn(`[BackendRegistry] Health check failed for ${name}:`, error);
        }
      } else {
        // This shouldn't happen since we catch errors above, but handle it anyway
        console.error('[BackendRegistry] Unexpected health check rejection:', result.reason);
      }
    }

    return results;
  }
}
