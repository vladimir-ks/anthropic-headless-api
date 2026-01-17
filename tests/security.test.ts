/**
 * Security Test Suite
 *
 * Tests for security vulnerabilities identified in deep review:
 * - Path traversal attacks
 * - JSON injection attempts
 * - Empty query validation
 */

import { describe, test, expect } from 'bun:test';
import {
  readContextFromDirectory,
  readContextFiles,
} from '../src/lib/context-reader';
import { executeClaudeQuery } from '../src/lib/claude-cli';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdir, writeFile, rm } from 'fs/promises';

// =============================================================================
// PATH TRAVERSAL TESTS
// =============================================================================

describe('Path Traversal Prevention', () => {
  test('should reject path traversal in readContextFromDirectory', async () => {
    const testDir = join(tmpdir(), 'security-test-' + Date.now());
    await mkdir(testDir, { recursive: true });

    try {
      // Attempt to read parent directory - should catch error and return empty
      const result = await readContextFromDirectory('../../etc', 'CONTEXT.md');

      // Path validation logs error and returns empty result
      expect(result.contextMd).toBeNull();
      expect(result.directoryContents).toEqual([]);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });

  test('should handle valid directory within cwd', async () => {
    // Use relative path within project for testing
    const validPath = './tests';

    const result = await readContextFromDirectory(validPath, 'CONTEXT.md');

    // Should succeed for valid directory within cwd
    expect(result.contextMd).toBeDefined(); // null or string is fine
    expect(result.directoryContents).toBeDefined();
  });

  test('should reject path traversal in readContextFiles', async () => {
    const testDir = join(tmpdir(), 'security-test-files-' + Date.now());
    await mkdir(testDir, { recursive: true });

    try {
      // Attempt to read files outside directory
      const result = await readContextFiles(testDir, [
        '../../etc/passwd',
        '../../../config.env',
      ]);

      // Should return empty map (no files found)
      expect(result.size).toBe(0);
    } finally {
      await rm(testDir, { recursive: true, force: true });
    }
  });
});

// =============================================================================
// JSON INJECTION TESTS
// =============================================================================

describe('JSON Injection Prevention', () => {
  test('should reject JSON schema exceeding depth limit', async () => {
    // Create deeply nested JSON (>10 levels)
    let deepObj: any = { value: 'leaf' };
    for (let i = 0; i < 15; i++) {
      deepObj = { nested: deepObj };
    }

    await expect(
      executeClaudeQuery({
        query: 'test',
        jsonSchema: deepObj,
      })
    ).rejects.toThrow(/exceeds maximum depth/i);
  });

  test('should reject JSON schema exceeding size limit', async () => {
    // Create large JSON object (>10KB)
    const largeObj = {
      data: 'x'.repeat(15000), // 15KB of data
    };

    await expect(
      executeClaudeQuery({
        query: 'test',
        jsonSchema: largeObj,
      })
    ).rejects.toThrow(/exceeds maximum size/i);
  });

  test('should reject JSON with command substitution patterns', async () => {
    const maliciousSchema = {
      command: '$(rm -rf /)',
    };

    await expect(
      executeClaudeQuery({
        query: 'test',
        jsonSchema: maliciousSchema,
      })
    ).rejects.toThrow(/suspicious pattern/i);
  });

  test('should reject JSON with backtick patterns', async () => {
    const maliciousSchema = {
      command: '`cat /etc/passwd`',
    };

    await expect(
      executeClaudeQuery({
        query: 'test',
        jsonSchema: maliciousSchema,
      })
    ).rejects.toThrow(/suspicious pattern/i);
  });

  test('should reject JSON with command chaining', async () => {
    const maliciousSchema = {
      command: 'echo test && rm -rf /',
    };

    await expect(
      executeClaudeQuery({
        query: 'test',
        jsonSchema: maliciousSchema,
      })
    ).rejects.toThrow(/suspicious pattern/i);
  });

  test('should accept valid JSON schema', async () => {
    const validSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['name'],
    };

    // Should not throw validation error
    // Validation should pass (execution will fail due to no Claude CLI in test env)
    try {
      await executeClaudeQuery({
        query: 'test',
        jsonSchema: validSchema,
        timeout: 100,
      });
      // If it somehow succeeds, that's ok - validation passed
    } catch (error) {
      // Should be Claude CLI error, not validation error
      expect((error as Error).message).not.toMatch(/suspicious pattern/i);
      expect((error as Error).message).not.toMatch(/exceeds maximum/i);
    }
  });
});

// =============================================================================
// EMPTY QUERY VALIDATION
// =============================================================================

describe('Empty Query Validation', () => {
  test('should reject empty query string', async () => {
    await expect(
      executeClaudeQuery({
        query: '',
      })
    ).rejects.toThrow(/Query cannot be empty/i);
  });

  test('should reject whitespace-only query', async () => {
    await expect(
      executeClaudeQuery({
        query: '   \n\t  ',
      })
    ).rejects.toThrow(/Query cannot be empty/i);
  });

  test('should accept valid query', async () => {
    // Should not throw validation error
    try {
      await executeClaudeQuery({
        query: 'Hello',
        timeout: 100,
      });
      // If succeeds, validation passed
    } catch (error) {
      // Should be CLI error, not validation error
      expect((error as Error).message).not.toMatch(/Query cannot be empty/i);
    }
  });
});

// =============================================================================
// AGENT PARAMETER VALIDATION
// =============================================================================

describe('Agent Parameter Validation', () => {
  test('should reject oversized agents parameter', async () => {
    const largeAgents = {
      agent1: { config: 'x'.repeat(15000) },
    };

    await expect(
      executeClaudeQuery({
        query: 'test',
        agents: largeAgents,
      })
    ).rejects.toThrow(/exceeds maximum size/i);
  });

  test('should reject deeply nested agents parameter', async () => {
    let deepObj: any = { value: 'leaf' };
    for (let i = 0; i < 15; i++) {
      deepObj = { nested: deepObj };
    }

    await expect(
      executeClaudeQuery({
        query: 'test',
        agents: deepObj,
      })
    ).rejects.toThrow(/exceeds maximum depth/i);
  });
});
