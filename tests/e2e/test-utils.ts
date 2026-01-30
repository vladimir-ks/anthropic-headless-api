/**
 * E2E Test Utilities
 *
 * Shared helpers, constants, and utilities for E2E testing
 */

export const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3456';

/**
 * Check if E2E tests should run
 * Set ENABLE_E2E_TESTS=true to enable
 */
export const E2E_ENABLED = process.env.ENABLE_E2E_TESTS === 'true';

// Test result collection
export interface TestResult {
  name: string;
  status: 'pass' | 'fail' | 'skip';
  duration: number;
  error?: string;
  response?: {
    status: number;
    body: unknown;
  };
}

export const testResults: TestResult[] = [];

/**
 * Helper to make requests with timing
 */
export async function timedFetch(
  url: string,
  options: RequestInit = {}
): Promise<{ response: Response; duration: number }> {
  const start = performance.now();
  const response = await fetch(url, options);
  const duration = performance.now() - start;
  return { response, duration };
}

/**
 * Helper to make chat completion request
 */
export async function chatCompletion(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): Promise<{ response: Response; data: unknown; duration: number }> {
  const { response, duration } = await timedFetch(`${BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return { response, data, duration };
}

/**
 * Wait for server to be ready
 */
export async function waitForServer(maxRetries = 30, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return true;
    } catch {
      // Server not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  return false;
}

/**
 * Check if server has API backends available
 * Returns true if API backends exist, false if only tool backends
 */
export async function hasAPIBackends(): Promise<boolean> {
  try {
    const response = await fetch(`${BASE_URL}/health`);
    if (!response.ok) return false;
    const data = await response.json() as { routing?: { backends?: { api?: number } } };
    return (data.routing?.backends?.api ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Skip test if no API backends
 * Use in beforeAll: await skipIfNoAPIBackends()
 */
export async function skipIfNoAPIBackends(): Promise<void> {
  const hasAPI = await hasAPIBackends();
  if (!hasAPI) {
    console.warn('⚠️ Skipping E2E tests: No API backends configured (only tool backends)');
  }
}

/**
 * Generate UUID v4
 */
export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Simple message helper
 */
export function createMessage(role: 'user' | 'assistant' | 'system', content: string) {
  return { role, content };
}

/**
 * Create minimal valid request body
 */
export function minimalRequest() {
  return {
    messages: [createMessage('user', 'Hi')],
  };
}

/**
 * Create request with all optional fields
 */
export function fullRequest() {
  return {
    model: 'haiku',
    messages: [
      createMessage('system', 'You are helpful.'),
      createMessage('user', 'Hello'),
    ],
    max_tokens: 100,
    temperature: 0.7,
    stream: false,
  };
}

/**
 * Read SSE stream and collect chunks
 */
export async function readSSEStream(response: Response): Promise<{
  chunks: unknown[];
  finalChunk: unknown | null;
  doneReceived: boolean;
}> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No reader available');

  const decoder = new TextDecoder();
  const chunks: unknown[] = [];
  let finalChunk: unknown | null = null;
  let doneReceived = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = decoder.decode(value);
      const lines = text.split('\n').filter((l) => l.startsWith('data: '));

      for (const line of lines) {
        const data = line.slice(6);
        if (data === '[DONE]') {
          doneReceived = true;
          break;
        }

        try {
          const chunk = JSON.parse(data);
          chunks.push(chunk);
          if (chunk.choices?.[0]?.finish_reason === 'stop') {
            finalChunk = chunk;
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (doneReceived) break;
    }
  } finally {
    reader.releaseLock();
  }

  return { chunks, finalChunk, doneReceived };
}

/**
 * Save test results to file
 */
export async function saveResults(filename: string): Promise<void> {
  const summary = {
    timestamp: new Date().toISOString(),
    total: testResults.length,
    passed: testResults.filter(r => r.status === 'pass').length,
    failed: testResults.filter(r => r.status === 'fail').length,
    skipped: testResults.filter(r => r.status === 'skip').length,
    results: testResults,
  };

  await Bun.write(`tests/results/${filename}`, JSON.stringify(summary, null, 2));
}
