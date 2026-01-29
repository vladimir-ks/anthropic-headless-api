/**
 * Security Utilities
 *
 * Input validation and sanitization for auth pool.
 */

import { createModuleLogger } from './logger';

const logger = createModuleLogger('Security');

/**
 * Validate webhook URL
 * Ensures URL is HTTPS and not localhost in production
 */
export function validateWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Must be HTTP or HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      logger.warn('Invalid webhook URL protocol', { url, protocol: parsed.protocol });
      return false;
    }

    // Warn if HTTP (not HTTPS)
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      logger.warn('Webhook URL should use HTTPS in production', { url });
    }

    // Warn if localhost in production
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(parsed.hostname) && process.env.NODE_ENV === 'production') {
      logger.warn('Webhook URL points to localhost in production', { url });
    }

    return true;
  } catch (error) {
    logger.error('Invalid webhook URL format', error as Error, { url });
    return false;
  }
}

/**
 * Validate config directory path
 * Prevents directory traversal attacks
 */
export function validateConfigPath(configPath: string): boolean {
  // Check for directory traversal patterns
  const dangerousPatterns = [
    /\.\./,  // Parent directory
    /\/\//,  // Double slash
    /~(?!\/\.claude)/,  // Tilde not followed by /.claude (allow ~/.claude-*)
    /\0/,    // Null byte
  ];

  for (const pattern of dangerousPatterns) {
    if (pattern.test(configPath)) {
      logger.error('Config path contains dangerous pattern', undefined, {
        configPath,
        pattern: pattern.toString(),
      });
      return false;
    }
  }

  // Must contain .claude
  if (!configPath.includes('.claude')) {
    logger.warn('Config path does not contain .claude', { configPath });
    return false;
  }

  return true;
}

/**
 * Sanitize subscription ID
 * Ensures ID contains only alphanumeric, dash, underscore
 */
export function sanitizeSubscriptionId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Redact sensitive data for logging
 */
export function redactSensitive(data: any): any {
  if (typeof data !== 'object' || data === null) {
    return data;
  }

  const redacted = { ...data };
  const sensitiveKeys = ['password', 'token', 'apiKey', 'secret', 'credential'];

  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      redacted[key] = '[REDACTED]';
    }
  }

  return redacted;
}
