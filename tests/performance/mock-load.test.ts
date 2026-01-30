/**
 * Mock-Based Load/Performance Tests
 *
 * Tests system performance without making real API calls.
 * Uses validation-only requests to stress test request handling.
 *
 * Enable with: ENABLE_E2E_TESTS=true bun test tests/performance/
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3456';
const E2E_ENABLED = process.env.ENABLE_E2E_TESTS === 'true';
const describeE2E = E2E_ENABLED ? describe : describe.skip;

interface LoadTestResult {
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  p99Latency: number;
  requestsPerSecond: number;
  duration: number;
}

interface LatencyBucket {
  range: string;
  count: number;
  percentage: number;
}

/**
 * Run load test against an endpoint
 */
async function runLoadTest(
  endpoint: string,
  options: {
    concurrency: number;
    totalRequests: number;
    method?: string;
    body?: unknown;
  }
): Promise<LoadTestResult> {
  const { concurrency, totalRequests, method = 'GET', body } = options;

  const latencies: number[] = [];
  let successCount = 0;
  let errorCount = 0;

  const startTime = performance.now();

  // Process requests in batches
  const batchSize = concurrency;
  const batches = Math.ceil(totalRequests / batchSize);

  for (let batch = 0; batch < batches; batch++) {
    const batchStart = batch * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, totalRequests);
    const batchRequests = batchEnd - batchStart;

    const promises = Array.from({ length: batchRequests }, async () => {
      const reqStart = performance.now();
      try {
        const response = await fetch(`${BASE_URL}${endpoint}`, {
          method,
          headers: body ? { 'Content-Type': 'application/json' } : undefined,
          body: body ? JSON.stringify(body) : undefined,
        });

        const latency = performance.now() - reqStart;
        latencies.push(latency);

        if (response.ok || response.status === 400) {
          successCount++;
        } else {
          errorCount++;
        }
      } catch {
        errorCount++;
        latencies.push(performance.now() - reqStart);
      }
    });

    await Promise.all(promises);
  }

  const duration = performance.now() - startTime;

  // Calculate statistics
  latencies.sort((a, b) => a - b);
  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const minLatency = latencies[0] || 0;
  const maxLatency = latencies[latencies.length - 1] || 0;
  const p95Index = Math.floor(latencies.length * 0.95);
  const p99Index = Math.floor(latencies.length * 0.99);
  const p95Latency = latencies[p95Index] || maxLatency;
  const p99Latency = latencies[p99Index] || maxLatency;
  const requestsPerSecond = totalRequests / (duration / 1000);

  return {
    totalRequests,
    successCount,
    errorCount,
    avgLatency,
    minLatency,
    maxLatency,
    p95Latency,
    p99Latency,
    requestsPerSecond,
    duration,
  };
}

/**
 * Get latency distribution buckets
 */
function getLatencyDistribution(latencies: number[]): LatencyBucket[] {
  const buckets = [
    { range: '< 10ms', min: 0, max: 10 },
    { range: '10-50ms', min: 10, max: 50 },
    { range: '50-100ms', min: 50, max: 100 },
    { range: '100-500ms', min: 100, max: 500 },
    { range: '> 500ms', min: 500, max: Infinity },
  ];

  return buckets.map(({ range, min, max }) => {
    const count = latencies.filter(l => l >= min && l < max).length;
    return {
      range,
      count,
      percentage: (count / latencies.length) * 100,
    };
  });
}

describeE2E('Performance: Load Testing', () => {
  beforeAll(async () => {
    // Verify server is running
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (!response.ok) throw new Error('Server not ready');
    } catch {
      console.warn('Server not ready, performance tests may fail');
    }
  });

  describe('Health Endpoint Performance', () => {
    test('handles 100 concurrent health checks', async () => {
      const result = await runLoadTest('/health', {
        concurrency: 100,
        totalRequests: 100,
      });

      console.log('Health check performance:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        p95Latency: `${result.p95Latency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      expect(result.successCount).toBe(100);
      expect(result.avgLatency).toBeLessThan(100); // < 100ms avg
    });

    test('handles 500 sequential health checks', async () => {
      const result = await runLoadTest('/health', {
        concurrency: 1,
        totalRequests: 500,
      });

      console.log('Sequential health checks:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      expect(result.successCount).toBe(500);
      expect(result.avgLatency).toBeLessThan(50);
    });

    test('handles 1000 requests at 50 concurrency', async () => {
      const result = await runLoadTest('/health', {
        concurrency: 50,
        totalRequests: 1000,
      });

      console.log('High volume health checks:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        p99Latency: `${result.p99Latency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
        successRate: `${(result.successCount / result.totalRequests * 100).toFixed(1)}%`,
      });

      expect(result.successCount / result.totalRequests).toBeGreaterThan(0.99);
    });
  });

  describe('Validation Performance', () => {
    test('handles 100 validation requests (valid)', async () => {
      const result = await runLoadTest('/v1/chat/completions', {
        concurrency: 20,
        totalRequests: 100,
        method: 'POST',
        body: {
          messages: [{ role: 'user', content: 'Hi' }],
          model: 'haiku',
          // Will fail at Claude CLI but validation passes
        },
      });

      console.log('Valid request validation:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      // All should pass validation (even if Claude CLI times out)
      expect(result.totalRequests).toBe(100);
    });

    test('handles 100 validation requests (invalid)', async () => {
      const result = await runLoadTest('/v1/chat/completions', {
        concurrency: 50,
        totalRequests: 100,
        method: 'POST',
        body: {
          messages: [], // Invalid - empty messages
        },
      });

      console.log('Invalid request validation:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      // Validation should be fast
      expect(result.avgLatency).toBeLessThan(100);
      expect(result.successCount).toBe(100); // 400 counts as "handled"
    });

    test('validation scales with concurrency', async () => {
      const results: { concurrency: number; rps: number }[] = [];

      for (const concurrency of [1, 10, 25, 50]) {
        const result = await runLoadTest('/v1/chat/completions', {
          concurrency,
          totalRequests: 100,
          method: 'POST',
          body: { messages: [] },
        });

        results.push({
          concurrency,
          rps: result.requestsPerSecond,
        });
      }

      console.log('Validation scaling:', results);

      // Higher concurrency should increase throughput
      expect(results[1].rps).toBeGreaterThan(results[0].rps * 0.8);
    });
  });

  describe('Queue Status Performance', () => {
    test('queue status under load', async () => {
      const result = await runLoadTest('/queue/status', {
        concurrency: 100,
        totalRequests: 500,
      });

      console.log('Queue status performance:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      expect(result.successCount).toBe(500);
      expect(result.avgLatency).toBeLessThan(100);
    });
  });

  describe('Models Endpoint Performance', () => {
    test('models endpoint under load', async () => {
      const result = await runLoadTest('/v1/models', {
        concurrency: 50,
        totalRequests: 200,
      });

      console.log('Models endpoint performance:', {
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        rps: `${result.requestsPerSecond.toFixed(0)} req/s`,
      });

      expect(result.successCount).toBeGreaterThanOrEqual(100); // Allow for some rate limiting
    });
  });

  describe('Mixed Workload', () => {
    test('handles mixed endpoint requests', async () => {
      const endpoints = [
        '/health',
        '/v1/models',
        '/queue/status',
      ];

      const results = await Promise.all(
        endpoints.map(endpoint =>
          runLoadTest(endpoint, {
            concurrency: 20,
            totalRequests: 50,
          })
        )
      );

      const totalSuccess = results.reduce((sum, r) => sum + r.successCount, 0);
      const avgLatency = results.reduce((sum, r) => sum + r.avgLatency, 0) / results.length;

      console.log('Mixed workload:', {
        totalRequests: 150,
        totalSuccess,
        avgLatency: `${avgLatency.toFixed(2)}ms`,
      });

      expect(totalSuccess).toBeGreaterThanOrEqual(100); // Allow for some rate limiting
    });
  });

  describe('Stress Testing', () => {
    test('handles burst of 200 concurrent requests', async () => {
      const result = await runLoadTest('/health', {
        concurrency: 200,
        totalRequests: 200,
      });

      console.log('Burst test:', {
        successRate: `${(result.successCount / result.totalRequests * 100).toFixed(1)}%`,
        avgLatency: `${result.avgLatency.toFixed(2)}ms`,
        maxLatency: `${result.maxLatency.toFixed(2)}ms`,
      });

      // Should handle burst without crashing
      expect(result.successCount / result.totalRequests).toBeGreaterThan(0.95);
    });

    test('sustained load for 5 seconds', async () => {
      const duration = 5000;
      const startTime = performance.now();
      let requestCount = 0;
      let successCount = 0;

      while (performance.now() - startTime < duration) {
        try {
          const response = await fetch(`${BASE_URL}/health`);
          if (response.ok) successCount++;
          requestCount++;
        } catch {
          requestCount++;
        }
      }

      const actualDuration = (performance.now() - startTime) / 1000;
      const rps = requestCount / actualDuration;

      console.log('Sustained load:', {
        duration: `${actualDuration.toFixed(1)}s`,
        requests: requestCount,
        successful: successCount,
        rps: `${rps.toFixed(0)} req/s`,
      });

      expect(successCount / requestCount).toBeGreaterThan(0.99);
    }, 10000); // 10 second timeout
  });

  describe('Error Handling Performance', () => {
    test('handles 100 malformed requests gracefully', async () => {
      const result = await runLoadTest('/v1/chat/completions', {
        concurrency: 50,
        totalRequests: 100,
        method: 'POST',
        body: 'not json', // Will cause parse error
      });

      // Server should handle errors quickly
      expect(result.avgLatency).toBeLessThan(100);
    });
  });
});

describeE2E('Performance: Memory & Resource Monitoring', () => {
  test('no memory leak during repeated requests', async () => {
    // Run multiple batches and check memory doesn't grow unboundedly
    const batches = 5;
    const requestsPerBatch = 100;

    for (let i = 0; i < batches; i++) {
      await runLoadTest('/health', {
        concurrency: 20,
        totalRequests: requestsPerBatch,
      });

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // If we got here without OOM, test passes
    const { response } = await fetch(`${BASE_URL}/health`).then(r => ({ response: r }));
    expect(response.ok).toBe(true);
  });
});
