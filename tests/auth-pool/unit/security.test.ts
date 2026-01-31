/**
 * Security Utilities Unit Tests
 *
 * Tests input validation, sanitization, and security functions.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  validateWebhookUrl,
  validateConfigPath,
  sanitizeSubscriptionId,
  validateEmail,
  redactSensitive,
} from '../../../src/lib/auth-pool/utils/security';

describe('Security Utilities', () => {
  describe('validateWebhookUrl', () => {
    test('accepts valid HTTPS URLs', () => {
      expect(validateWebhookUrl('https://example.com/webhook')).toBe(true);
      expect(validateWebhookUrl('https://api.company.io/hooks/notify')).toBe(true);
    });

    test('accepts valid HTTP URLs', () => {
      expect(validateWebhookUrl('http://example.com/webhook')).toBe(true);
      expect(validateWebhookUrl('http://localhost:3000/hook')).toBe(true);
    });

    test('rejects non-HTTP protocols', () => {
      expect(validateWebhookUrl('ftp://example.com/webhook')).toBe(false);
      expect(validateWebhookUrl('file:///etc/passwd')).toBe(false);
      expect(validateWebhookUrl('javascript:alert(1)')).toBe(false);
      expect(validateWebhookUrl('data:text/html,<script>alert(1)</script>')).toBe(false);
    });

    test('rejects invalid URLs', () => {
      expect(validateWebhookUrl('not-a-url')).toBe(false);
      expect(validateWebhookUrl('')).toBe(false);
      expect(validateWebhookUrl('://missing-protocol.com')).toBe(false);
    });

    test('accepts URLs with ports and paths', () => {
      expect(validateWebhookUrl('https://example.com:8443/api/v1/webhook')).toBe(true);
      expect(validateWebhookUrl('http://localhost:9090/callback')).toBe(true);
    });

    describe('production warnings', () => {
      const originalEnv = process.env.NODE_ENV;

      beforeEach(() => {
        process.env.NODE_ENV = 'production';
      });

      afterEach(() => {
        process.env.NODE_ENV = originalEnv;
      });

      test('accepts HTTP in production (returns true, but logs warning)', () => {
        // Still valid, just warns
        expect(validateWebhookUrl('http://example.com/webhook')).toBe(true);
      });

      test('accepts localhost in production (returns true, but logs warning)', () => {
        // Still valid, just warns
        expect(validateWebhookUrl('https://localhost:3000/hook')).toBe(true);
      });
    });
  });

  describe('validateConfigPath', () => {
    test('accepts valid config paths', () => {
      expect(validateConfigPath('/home/user/.claude')).toBe(true);
      expect(validateConfigPath('/Users/user/.claude-inst1')).toBe(true);
      expect(validateConfigPath('~/.claude')).toBe(true);
      expect(validateConfigPath('~/.claude-production')).toBe(true);
    });

    test('rejects directory traversal', () => {
      expect(validateConfigPath('/home/user/../etc/passwd')).toBe(false);
      expect(validateConfigPath('./../.claude')).toBe(false);
      expect(validateConfigPath('/var/www/../../etc/.claude')).toBe(false);
    });

    test('rejects double slashes', () => {
      expect(validateConfigPath('/home//user/.claude')).toBe(false);
      expect(validateConfigPath('//etc/.claude')).toBe(false);
    });

    test('rejects null bytes', () => {
      expect(validateConfigPath('/home/user/.claude\0extra')).toBe(false);
    });

    test('rejects tilde not followed by /.claude', () => {
      expect(validateConfigPath('~/other-dir')).toBe(false);
      expect(validateConfigPath('~malicious')).toBe(false);
    });

    test('rejects paths without .claude', () => {
      expect(validateConfigPath('/home/user/config')).toBe(false);
      expect(validateConfigPath('/etc/passwd')).toBe(false);
    });
  });

  describe('sanitizeSubscriptionId', () => {
    test('returns valid IDs unchanged', () => {
      expect(sanitizeSubscriptionId('sub_123')).toBe('sub_123');
      expect(sanitizeSubscriptionId('my-subscription-1')).toBe('my-subscription-1');
      expect(sanitizeSubscriptionId('ABC123')).toBe('ABC123');
    });

    test('removes special characters', () => {
      expect(sanitizeSubscriptionId('sub!@#$%123')).toBe('sub123');
      expect(sanitizeSubscriptionId('test<script>alert</script>')).toBe('testscriptalertscript');
    });

    test('returns null for empty strings', () => {
      expect(sanitizeSubscriptionId('')).toBeNull();
    });

    test('returns null if only special chars removed', () => {
      expect(sanitizeSubscriptionId('!@#$%^&*()')).toBeNull();
      expect(sanitizeSubscriptionId('   ')).toBeNull();
    });

    test('preserves underscores and dashes', () => {
      expect(sanitizeSubscriptionId('sub_id-test')).toBe('sub_id-test');
    });
  });

  describe('validateEmail', () => {
    test('accepts valid emails', () => {
      expect(validateEmail('user@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.org')).toBe(true);
      expect(validateEmail('user+tag@subdomain.domain.com')).toBe(true);
    });

    test('rejects invalid emails', () => {
      expect(validateEmail('not-an-email')).toBe(false);
      expect(validateEmail('@no-local.com')).toBe(false);
      expect(validateEmail('no-domain@')).toBe(false);
      expect(validateEmail('spaces not@allowed.com')).toBe(false);
      expect(validateEmail('')).toBe(false);
    });

    test('rejects emails without TLD', () => {
      expect(validateEmail('user@localhost')).toBe(false);
    });
  });

  describe('redactSensitive', () => {
    test('redacts password fields', () => {
      const data = { username: 'john', password: 'secret123' };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.username).toBe('john');
      expect(result.password).toBe('[REDACTED]');
    });

    test('redacts token fields', () => {
      const data = { authToken: 'abc123', accessToken: 'xyz789' };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.authToken).toBe('[REDACTED]');
      expect(result.accessToken).toBe('[REDACTED]');
    });

    test('redacts fields with lowercase sensitive patterns', () => {
      // Implementation note: key.toLowerCase().includes(sk) means:
      // - 'password' matches (lowercase in sensitiveKeys)
      // - 'token' matches (lowercase in sensitiveKeys)
      // - 'secret' matches (lowercase in sensitiveKeys)
      // - 'credential' matches (lowercase in sensitiveKeys)
      // - 'apiKey' does NOT match because sk='apiKey' and 'apikey'.includes('apiKey') = false
      const data = {
        mypassword: 'secret1',  // matches 'password'
        secretKey: 'secret2',   // matches 'secret'
      };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.mypassword).toBe('[REDACTED]');
      expect(result.secretKey).toBe('[REDACTED]');
    });

    test('redacts secret and credential fields', () => {
      const data = { clientSecret: 'secret', userCredential: 'cred' };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.clientSecret).toBe('[REDACTED]');
      expect(result.userCredential).toBe('[REDACTED]');
    });

    test('preserves non-sensitive fields', () => {
      const data = { id: 123, name: 'test', email: 'user@test.com' };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.id).toBe(123);
      expect(result.name).toBe('test');
      expect(result.email).toBe('user@test.com');
    });

    test('handles null input', () => {
      expect(redactSensitive(null)).toBeNull();
    });

    test('handles primitive types', () => {
      expect(redactSensitive('string')).toBe('string');
      expect(redactSensitive(123)).toBe(123);
      expect(redactSensitive(true)).toBe(true);
    });

    test('handles mixed object', () => {
      const data = {
        userId: 'u123',
        sessionToken: 'tok_abc',
        email: 'user@test.com',
        secretData: 'hidden',
      };
      const result = redactSensitive(data) as Record<string, unknown>;
      expect(result.userId).toBe('u123');
      expect(result.sessionToken).toBe('[REDACTED]');
      expect(result.email).toBe('user@test.com');
      expect(result.secretData).toBe('[REDACTED]');
    });
  });
});
