#!/usr/bin/env bun
/**
 * Comprehensive E2E Test Runner
 *
 * Runs all E2E tests and collects results in a structured format.
 * Run: bun tests/scripts/run-all-e2e.ts
 */

import { spawn } from 'bun';
import { existsSync, mkdirSync } from 'fs';

const BASE_URL = process.env.TEST_BASE_URL || 'http://127.0.0.1:3456';
const RESULTS_DIR = 'tests/results';

interface TestSuiteResult {
  name: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  output: string;
}

async function waitForServer(maxRetries = 30): Promise<boolean> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`${BASE_URL}/health`);
      if (response.ok) return true;
    } catch {
      // Server not ready
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

async function runTestFile(testFile: string): Promise<TestSuiteResult> {
  const start = Date.now();

  const proc = spawn({
    cmd: ['bun', 'test', testFile],
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  const duration = Date.now() - start;
  const output = stdout + stderr;

  // Parse results from output
  const passMatch = output.match(/(\d+) pass/);
  const failMatch = output.match(/(\d+) fail/);

  return {
    name: testFile.split('/').pop() || testFile,
    passed: passMatch ? parseInt(passMatch[1]) : 0,
    failed: failMatch ? parseInt(failMatch[1]) : 0,
    skipped: 0,
    duration,
    output,
  };
}

async function main() {
  console.log('🧪 Comprehensive E2E Test Runner\n');

  // Ensure results directory exists
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true });
  }

  // Check server
  console.log('Checking server...');
  const serverReady = await waitForServer(10);

  if (!serverReady) {
    console.log('⚠️  Server not running. Starting server...');
    spawn({
      cmd: ['bun', 'run', 'src/index.ts'],
      stdout: 'ignore',
      stderr: 'ignore',
    });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const retryReady = await waitForServer(10);
    if (!retryReady) {
      console.error('❌ Could not start server');
      process.exit(1);
    }
  }

  console.log('✅ Server is ready\n');

  // Define test suites to run
  const testSuites = [
    // Unit tests (no server required, but included for completeness)
    'tests/path-validation.test.ts',
    'tests/router-logic.test.ts',
    'tests/router.test.ts',
    'tests/validation.test.ts',

    // E2E tests
    'tests/e2e/endpoints.test.ts',
    'tests/e2e/validation-comprehensive.test.ts',
    'tests/e2e/cors.test.ts',
    'tests/e2e/error-handling.test.ts',

    // Performance tests (mock-based)
    'tests/performance/mock-load-test.ts',
  ];

  const results: TestSuiteResult[] = [];
  let totalPassed = 0;
  let totalFailed = 0;

  console.log('Running test suites...\n');

  for (const suite of testSuites) {
    process.stdout.write(`  Running ${suite}... `);

    try {
      const result = await runTestFile(suite);
      results.push(result);
      totalPassed += result.passed;
      totalFailed += result.failed;

      if (result.failed > 0) {
        console.log(`❌ ${result.passed} passed, ${result.failed} failed (${result.duration}ms)`);
      } else {
        console.log(`✅ ${result.passed} passed (${result.duration}ms)`);
      }
    } catch (error) {
      console.log(`❌ Error: ${error}`);
      results.push({
        name: suite,
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: 0,
        output: String(error),
      });
      totalFailed++;
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`  Total Suites: ${testSuites.length}`);
  console.log(`  Total Passed: ${totalPassed}`);
  console.log(`  Total Failed: ${totalFailed}`);
  console.log(`  Pass Rate: ${(totalPassed / (totalPassed + totalFailed) * 100).toFixed(1)}%`);

  // Save detailed results
  const reportPath = `${RESULTS_DIR}/e2e-report-${Date.now()}.json`;
  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      totalSuites: testSuites.length,
      totalPassed,
      totalFailed,
      passRate: totalPassed / (totalPassed + totalFailed),
    },
    suites: results,
  };

  await Bun.write(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n💾 Report saved to ${reportPath}`);

  // Exit with error if any tests failed
  if (totalFailed > 0) {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  } else {
    console.log('\n✅ All tests passed!');
  }
}

main().catch(console.error);
