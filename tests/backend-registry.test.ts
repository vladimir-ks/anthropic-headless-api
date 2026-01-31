/**
 * Backend Registry Unit Tests
 *
 * Tests configuration loading, adapter instantiation, and registry operations.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BackendRegistry } from '../src/lib/backend-registry';
import { writeFileSync, unlinkSync, mkdirSync, rmdirSync, readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// Use project's temp directory instead of system /var/folders
const PROJECT_ROOT = resolve(__dirname, '..');
const TEST_TEMP_DIR = join(PROJECT_ROOT, 'tests', '.test-temp');

describe('BackendRegistry', () => {
  let tempDir: string;

  beforeEach(() => {
    // Create unique temp directory within project
    tempDir = join(TEST_TEMP_DIR, `backend-registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    if (!existsSync(TEST_TEMP_DIR)) {
      mkdirSync(TEST_TEMP_DIR, { recursive: true });
    }
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up temp files
    try {
      const files = readdirSync(tempDir);
      for (const file of files) {
        unlinkSync(join(tempDir, file));
      }
      rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('path validation', () => {
    test('blocks /etc directory', () => {
      expect(() => new BackendRegistry('/etc/backends.json')).toThrow('blocked');
    });

    test('blocks /var directory', () => {
      expect(() => new BackendRegistry('/var/log/backends.json')).toThrow('blocked');
    });

    test('blocks /usr directory', () => {
      expect(() => new BackendRegistry('/usr/share/backends.json')).toThrow('blocked');
    });

    test('blocks /root directory', () => {
      expect(() => new BackendRegistry('/root/.config/backends.json')).toThrow('blocked');
    });

    test('blocks /proc directory', () => {
      expect(() => new BackendRegistry('/proc/1/environ')).toThrow('blocked');
    });

    test('blocks /sys directory', () => {
      expect(() => new BackendRegistry('/sys/class/net/backends.json')).toThrow('blocked');
    });
  });

  describe('configuration loading', () => {
    test('throws on missing file', () => {
      const fakePath = join(tempDir, 'nonexistent.json');
      expect(() => new BackendRegistry(fakePath)).toThrow();
    });

    test('throws on invalid JSON', () => {
      const configPath = join(tempDir, 'invalid.json');
      writeFileSync(configPath, 'not valid json');
      expect(() => new BackendRegistry(configPath)).toThrow();
    });

    test('throws when no backends registered successfully', () => {
      const configPath = join(tempDir, 'empty-backends.json');
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'invalid-backend',
            type: 'api',
            provider: 'unknown-provider',
            baseUrl: 'https://example.com',
            authTokenEnv: 'NONEXISTENT_KEY',
            costPerRequest: 0.01,
            supportsTools: false,
          },
        ],
        routing: {
          defaultBackend: 'invalid-backend',
          preferCheapest: false,
          fallbackChain: [],
        },
      }));

      expect(() => new BackendRegistry(configPath)).toThrow('No backends successfully registered');
    });
  });

  describe('adapter instantiation', () => {
    test('creates ClaudeCLIAdapter for claude-cli type', () => {
      const configPath = join(tempDir, 'cli-config.json');
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'test-cli',
            type: 'claude-cli',
            configDir: '~/.claude',
            maxConcurrent: 2,
            queueSize: 10,
            timeout: 60000,
            costPerRequest: 0,
            supportsTools: true,
          },
        ],
        routing: {
          defaultBackend: 'test-cli',
          preferCheapest: false,
          fallbackChain: ['test-cli'],
        },
      }));

      const registry = new BackendRegistry(configPath);
      const backend = registry.getBackend('test-cli');

      expect(backend).toBeDefined();
      expect(backend?.name).toBe('test-cli');
      expect(backend?.type).toBe('claude-cli');
      expect(backend?.supportsTools).toBe(true);
    });

    test('creates AnthropicAPIAdapter for anthropic provider', () => {
      // Set test API key
      process.env.TEST_ANTHROPIC_KEY = 'test-key';

      const configPath = join(tempDir, 'anthropic-config.json');
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'test-anthropic',
            type: 'api',
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-3-haiku-20240307',
            authTokenEnv: 'TEST_ANTHROPIC_KEY',
            costPerRequest: 0.01,
            supportsTools: false,
          },
        ],
        routing: {
          defaultBackend: 'test-anthropic',
          preferCheapest: false,
          fallbackChain: ['test-anthropic'],
        },
      }));

      const registry = new BackendRegistry(configPath);
      const backend = registry.getBackend('test-anthropic');

      expect(backend).toBeDefined();
      expect(backend?.name).toBe('test-anthropic');
      expect(backend?.type).toBe('api');
      expect(backend?.supportsTools).toBe(false);

      delete process.env.TEST_ANTHROPIC_KEY;
    });

    test('handles unknown provider gracefully', () => {
      process.env.TEST_KEY = 'test-key';

      const configPath = join(tempDir, 'unknown-config.json');
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'fallback-cli',
            type: 'claude-cli',
            configDir: '~/.claude',
            maxConcurrent: 1,
            queueSize: 5,
            timeout: 30000,
            costPerRequest: 0,
            supportsTools: true,
          },
          {
            name: 'unknown-backend',
            type: 'api',
            provider: 'mystery-provider',
            baseUrl: 'https://mystery.ai/v1',
            model: 'mystery-model',
            authTokenEnv: 'TEST_KEY',
            costPerRequest: 0.01,
            supportsTools: false,
          },
        ],
        routing: {
          defaultBackend: 'fallback-cli',
          preferCheapest: false,
          fallbackChain: ['fallback-cli'],
        },
      }));

      // Should still work because fallback-cli is valid
      const registry = new BackendRegistry(configPath);
      expect(registry.getBackend('unknown-backend')).toBeUndefined();
      expect(registry.getBackend('fallback-cli')).toBeDefined();

      delete process.env.TEST_KEY;
    });
  });

  describe('registry operations', () => {
    let registry: BackendRegistry;
    let configPath: string;

    beforeEach(() => {
      process.env.TEST_API_KEY = 'test-key';

      configPath = join(tempDir, `registry-ops-${Date.now()}.json`);
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'cli-backend',
            type: 'claude-cli',
            configDir: '~/.claude',
            maxConcurrent: 2,
            queueSize: 10,
            timeout: 60000,
            costPerRequest: 0,
            supportsTools: true,
          },
          {
            name: 'api-backend',
            type: 'api',
            provider: 'anthropic',
            baseUrl: 'https://api.anthropic.com/v1',
            model: 'claude-3-haiku-20240307',
            authTokenEnv: 'TEST_API_KEY',
            costPerRequest: 0.01,
            supportsTools: false,
          },
        ],
        routing: {
          defaultBackend: 'cli-backend',
          preferCheapest: true,
          fallbackChain: ['cli-backend', 'api-backend'],
        },
      }));

      registry = new BackendRegistry(configPath);
    });

    afterEach(() => {
      delete process.env.TEST_API_KEY;
      try {
        unlinkSync(configPath);
      } catch {
        // Ignore
      }
    });

    test('getAllBackends returns all registered backends', () => {
      const backends = registry.getAllBackends();
      expect(backends.length).toBe(2);
    });

    test('getToolBackends returns only tool-supporting backends', () => {
      const toolBackends = registry.getToolBackends();
      expect(toolBackends.length).toBe(1);
      expect(toolBackends[0].name).toBe('cli-backend');
      expect(toolBackends[0].supportsTools).toBe(true);
    });

    test('getAPIBackends returns only non-tool backends', () => {
      const apiBackends = registry.getAPIBackends();
      expect(apiBackends.length).toBe(1);
      expect(apiBackends[0].name).toBe('api-backend');
      expect(apiBackends[0].supportsTools).toBe(false);
    });

    test('getDefaultBackend returns configured default', () => {
      const defaultBackend = registry.getDefaultBackend();
      expect(defaultBackend).toBeDefined();
      expect(defaultBackend?.name).toBe('cli-backend');
    });

    test('getFallbackChain returns ordered chain', () => {
      const chain = registry.getFallbackChain();
      expect(chain.length).toBe(2);
      expect(chain[0].name).toBe('cli-backend');
      expect(chain[1].name).toBe('api-backend');
    });

    test('getRoutingConfig returns routing settings', () => {
      const routingConfig = registry.getRoutingConfig();
      expect(routingConfig.defaultBackend).toBe('cli-backend');
      expect(routingConfig.preferCheapest).toBe(true);
      expect(routingConfig.fallbackChain).toEqual(['cli-backend', 'api-backend']);
    });

    test('getBackend returns undefined for unknown name', () => {
      expect(registry.getBackend('nonexistent')).toBeUndefined();
    });
  });

  describe('healthCheck', () => {
    test('runs health checks in parallel', async () => {
      process.env.TEST_API_KEY = 'test-key';

      const configPath = join(tempDir, 'health-config.json');
      writeFileSync(configPath, JSON.stringify({
        backends: [
          {
            name: 'health-cli',
            type: 'claude-cli',
            configDir: '~/.claude',
            maxConcurrent: 1,
            queueSize: 5,
            timeout: 30000,
            costPerRequest: 0,
            supportsTools: true,
          },
        ],
        routing: {
          defaultBackend: 'health-cli',
          preferCheapest: false,
          fallbackChain: ['health-cli'],
        },
      }));

      const registry = new BackendRegistry(configPath);
      const results = await registry.healthCheck();

      expect(results.size).toBe(1);
      // Health check result (may be false if claude CLI not available)
      expect(typeof results.get('health-cli')).toBe('boolean');

      delete process.env.TEST_API_KEY;
    });
  });
});
