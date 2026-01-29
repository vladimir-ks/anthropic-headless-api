/**
 * Router Logic Unit Tests
 *
 * Tests core routing logic without complex mocks
 */

import { describe, test, expect } from 'bun:test';
import type { ChatCompletionRequest } from '../src/types/api';

// Test the requiresTools logic from router
function requiresTools(request: ChatCompletionRequest): boolean {
  return !!(
    request.allowed_tools?.length ||
    request.disallowed_tools?.length ||
    request.working_directory ||
    request.context_files?.length ||
    request.add_dirs?.length
  );
}

describe('Router Logic', () => {
  describe('requiresTools detection', () => {
    test('returns false for simple chat request', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
      };

      expect(requiresTools(request)).toBe(false);
    });

    test('returns true when allowed_tools specified', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        allowed_tools: ['Bash', 'Read'],
      };

      expect(requiresTools(request)).toBe(true);
    });

    test('returns true when disallowed_tools specified', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        disallowed_tools: ['WebSearch'],
      };

      expect(requiresTools(request)).toBe(true);
    });

    test('returns true when working_directory specified', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        working_directory: '/tmp/workspace',
      };

      expect(requiresTools(request)).toBe(true);
    });

    test('returns true when context_files specified', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        context_files: ['file.txt'],
      };

      expect(requiresTools(request)).toBe(true);
    });

    test('returns true when add_dirs specified', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        add_dirs: ['/tmp/extra'],
      };

      expect(requiresTools(request)).toBe(true);
    });

    test('returns false when arrays are empty', () => {
      const request: ChatCompletionRequest = {
        messages: [{ role: 'user', content: 'Hello' }],
        allowed_tools: [],
        context_files: [],
      };

      expect(requiresTools(request)).toBe(false);
    });
  });
});
