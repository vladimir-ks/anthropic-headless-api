#!/usr/bin/env bun
/**
 * User Simulation Script
 *
 * Simulates multiple concurrent users making requests to the API.
 * Run: bun tests/scripts/simulate-users.ts [options]
 *
 * Options:
 *   --users=N      Number of concurrent users (default: 5)
 *   --duration=N   Duration in seconds (default: 30)
 *   --real-api     Make real API calls (costs money!)
 *   --output=FILE  Save results to JSON file
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3456';

interface UserSession {
  userId: string;
  sessionId?: string;
  requestCount: number;
  successCount: number;
  errorCount: number;
  latencies: number[];
  startTime: number;
  endTime?: number;
}

interface SimulationResult {
  timestamp: string;
  config: {
    users: number;
    duration: number;
    realApi: boolean;
  };
  users: UserSession[];
  aggregate: {
    totalRequests: number;
    totalSuccess: number;
    totalErrors: number;
    avgLatency: number;
    p95Latency: number;
    requestsPerSecond: number;
  };
}

function parseArgs(): { users: number; duration: number; realApi: boolean; output?: string } {
  const args = process.argv.slice(2);
  const config = {
    users: 5,
    duration: 30,
    realApi: false,
    output: undefined as string | undefined,
  };

  for (const arg of args) {
    if (arg.startsWith('--users=')) config.users = parseInt(arg.split('=')[1]);
    if (arg.startsWith('--duration=')) config.duration = parseInt(arg.split('=')[1]);
    if (arg === '--real-api') config.realApi = true;
    if (arg.startsWith('--output=')) config.output = arg.split('=')[1];
  }

  return config;
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

async function simulateUser(
  userId: string,
  duration: number,
  realApi: boolean
): Promise<UserSession> {
  const session: UserSession = {
    userId,
    requestCount: 0,
    successCount: 0,
    errorCount: 0,
    latencies: [],
    startTime: Date.now(),
  };

  const endTime = session.startTime + duration * 1000;

  // User behavior patterns
  const behaviors = [
    { type: 'health-check', weight: 40 },
    { type: 'models', weight: 10 },
    { type: 'queue-status', weight: 10 },
    { type: 'validation-only', weight: 30 },
    { type: 'chat', weight: realApi ? 10 : 0 },
  ];

  const totalWeight = behaviors.reduce((sum, b) => sum + b.weight, 0);

  while (Date.now() < endTime) {
    // Select behavior based on weights
    let random = Math.random() * totalWeight;
    let selectedBehavior = behaviors[0].type;

    for (const behavior of behaviors) {
      random -= behavior.weight;
      if (random <= 0) {
        selectedBehavior = behavior.type;
        break;
      }
    }

    const requestStart = performance.now();
    let success = false;

    try {
      switch (selectedBehavior) {
        case 'health-check':
          const healthRes = await fetch(`${BASE_URL}/health`);
          success = healthRes.ok;
          break;

        case 'models':
          const modelsRes = await fetch(`${BASE_URL}/v1/models`);
          success = modelsRes.ok;
          break;

        case 'queue-status':
          const queueRes = await fetch(`${BASE_URL}/queue/status`);
          success = queueRes.ok;
          break;

        case 'validation-only':
          // Send request that will fail validation (fast, no API cost)
          const validationRes = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [], // Invalid - will fail validation
            }),
          });
          success = validationRes.status === 400;
          break;

        case 'chat':
          if (!session.sessionId) {
            session.sessionId = generateUUID();
          }
          const chatRes = await fetch(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: 'haiku',
              messages: [{ role: 'user', content: 'Say "ok"' }],
              session_id: session.sessionId,
            }),
          });
          success = chatRes.ok;

          // Update session_id from response if successful
          if (success) {
            const data = await chatRes.json();
            session.sessionId = data.session_id;
          }
          break;
      }
    } catch (error) {
      success = false;
    }

    const latency = performance.now() - requestStart;
    session.latencies.push(latency);
    session.requestCount++;

    if (success) {
      session.successCount++;
    } else {
      session.errorCount++;
    }

    // Variable delay between requests (simulate human behavior)
    const delay = 100 + Math.random() * 400;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  session.endTime = Date.now();
  return session;
}

function calculateResults(sessions: UserSession[], config: any): SimulationResult {
  const allLatencies: number[] = [];
  let totalRequests = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  for (const session of sessions) {
    allLatencies.push(...session.latencies);
    totalRequests += session.requestCount;
    totalSuccess += session.successCount;
    totalErrors += session.errorCount;
  }

  allLatencies.sort((a, b) => a - b);
  const avgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
  const p95Index = Math.floor(allLatencies.length * 0.95);
  const p95Latency = allLatencies[p95Index] || avgLatency;

  const totalDuration = sessions.reduce(
    (sum, s) => sum + ((s.endTime || Date.now()) - s.startTime),
    0
  ) / 1000;

  return {
    timestamp: new Date().toISOString(),
    config: {
      users: config.users,
      duration: config.duration,
      realApi: config.realApi,
    },
    users: sessions,
    aggregate: {
      totalRequests,
      totalSuccess,
      totalErrors,
      avgLatency,
      p95Latency,
      requestsPerSecond: totalRequests / (totalDuration / sessions.length),
    },
  };
}

async function main() {
  const config = parseArgs();

  console.log('🚀 Starting user simulation');
  console.log(`   Users: ${config.users}`);
  console.log(`   Duration: ${config.duration}s`);
  console.log(`   Real API: ${config.realApi}`);
  console.log('');

  // Check server is running
  try {
    const health = await fetch(`${BASE_URL}/health`);
    if (!health.ok) throw new Error('Server not healthy');
    console.log('✅ Server is healthy\n');
  } catch {
    console.error('❌ Server is not running at', BASE_URL);
    process.exit(1);
  }

  // Start all user simulations
  console.log('Starting users...');
  const userPromises = Array.from({ length: config.users }, (_, i) =>
    simulateUser(`user-${i + 1}`, config.duration, config.realApi)
  );

  // Progress indicator
  const progressInterval = setInterval(() => {
    process.stdout.write('.');
  }, 1000);

  const sessions = await Promise.all(userPromises);

  clearInterval(progressInterval);
  console.log('\n');

  // Calculate and display results
  const results = calculateResults(sessions, config);

  console.log('📊 Results:');
  console.log(`   Total Requests: ${results.aggregate.totalRequests}`);
  console.log(`   Successful: ${results.aggregate.totalSuccess}`);
  console.log(`   Errors: ${results.aggregate.totalErrors}`);
  console.log(`   Success Rate: ${(results.aggregate.totalSuccess / results.aggregate.totalRequests * 100).toFixed(1)}%`);
  console.log(`   Avg Latency: ${results.aggregate.avgLatency.toFixed(2)}ms`);
  console.log(`   P95 Latency: ${results.aggregate.p95Latency.toFixed(2)}ms`);
  console.log(`   Throughput: ${results.aggregate.requestsPerSecond.toFixed(1)} req/s`);

  console.log('\n📋 Per-User Stats:');
  for (const session of sessions) {
    const avgLat = session.latencies.reduce((a, b) => a + b, 0) / session.latencies.length;
    console.log(`   ${session.userId}: ${session.requestCount} requests, ${avgLat.toFixed(1)}ms avg`);
  }

  // Save results if output specified
  if (config.output) {
    await Bun.write(config.output, JSON.stringify(results, null, 2));
    console.log(`\n💾 Results saved to ${config.output}`);
  }
}

main().catch(console.error);
