/**
 * Path Validation Security Tests
 *
 * Validates that path traversal protections work correctly
 */

import { describe, test, expect } from 'bun:test';
import { ChatCompletionRequestSchema } from '../src/validation/schemas';

describe('Path Validation Security', () => {
  describe('working_directory validation', () => {
    test('allows valid working directory paths', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        working_directory: '/tmp/workspace',
      });

      expect(result.success).toBe(true);
    });

    test('blocks path traversal with .. in working_directory', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        working_directory: '/tmp/../etc',
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('path traversal');
      }
    });
  });

  describe('context_files validation', () => {
    test('allows valid context file paths', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['file1.txt', 'dir/file2.txt'],
      });

      expect(result.success).toBe(true);
    });

    test('blocks path traversal in context_files', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['../../etc/passwd'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('path traversal');
      }
    });

    test('blocks access to /etc directory', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['/etc/passwd'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('system directories');
      }
    });

    test('blocks access to /var directory', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['/var/log/syslog'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('system directories');
      }
    });

    test('enforces maximum of 100 context files', () => {
      const tooManyFiles = Array.from({ length: 101 }, (_, i) => `file${i}.txt`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: tooManyFiles,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('100 files');
      }
    });

    test('allows up to 100 context files', () => {
      const maxFiles = Array.from({ length: 100 }, (_, i) => `file${i}.txt`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: maxFiles,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('add_dirs validation', () => {
    test('allows valid directory paths', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        add_dirs: ['/tmp/workspace', '/home/user/project'],
      });

      expect(result.success).toBe(true);
    });

    test('blocks path traversal in add_dirs', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        add_dirs: ['../../../etc'],
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('path traversal');
      }
    });

    test('blocks access to system directories', () => {
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        add_dirs: ['/etc'],
      });

      expect(result.success).toBe(false);
    });

    test('enforces maximum of 20 directories', () => {
      const tooManyDirs = Array.from({ length: 21 }, (_, i) => `/tmp/dir${i}`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        add_dirs: tooManyDirs,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('20 directories');
      }
    });
  });

  describe('Array bounds validation', () => {
    test('enforces maximum of 50 allowed_tools', () => {
      const tooManyTools = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        allowed_tools: tooManyTools,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('50 tools');
      }
    });

    test('enforces maximum of 50 disallowed_tools', () => {
      const tooManyTools = Array.from({ length: 51 }, (_, i) => `Tool${i}`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        disallowed_tools: tooManyTools,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('50 tools');
      }
    });

    test('enforces maximum of 20 mcp_config items', () => {
      const tooManyItems = Array.from({ length: 21 }, (_, i) => `config${i}`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        mcp_config: tooManyItems,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('20 items');
      }
    });

    test('enforces maximum of 10 beta features', () => {
      const tooManyBetas = Array.from({ length: 11 }, (_, i) => `beta${i}`);
      const result = ChatCompletionRequestSchema.safeParse({
        messages: [{ role: 'user', content: 'Hello' }],
        betas: tooManyBetas,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('10 beta');
      }
    });
  });
});
