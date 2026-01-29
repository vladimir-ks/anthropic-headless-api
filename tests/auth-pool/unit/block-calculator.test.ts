/**
 * Block Calculator Unit Tests
 *
 * Tests 5-hour block calculations for Anthropic's billing windows.
 * Written BEFORE implementation (TDD).
 */

import { describe, test, expect } from 'bun:test';
import {
  getActiveBlockId,
  getBlockStartTime,
  getBlockEndTime,
  isBlockActive,
  getBlockProgress,
} from '../../../src/lib/auth-pool/utils/block-calculator';

describe('BlockCalculator', () => {
  describe('getActiveBlockId()', () => {
    test('should return block starting at 00:00 UTC for times 00:00-04:59', () => {
      const timestamp = new Date('2026-01-28T00:30:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T00:00:00.000Z');
    });

    test('should return block starting at 05:00 UTC for times 05:00-09:59', () => {
      const timestamp = new Date('2026-01-28T05:15:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T05:00:00.000Z');
    });

    test('should return block starting at 10:00 UTC for times 10:00-14:59', () => {
      const timestamp = new Date('2026-01-28T12:30:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T10:00:00.000Z');
    });

    test('should return block starting at 15:00 UTC for times 15:00-19:59', () => {
      const timestamp = new Date('2026-01-28T19:45:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T15:00:00.000Z');
    });

    test('should return block starting at 20:00 UTC for times 20:00-23:59', () => {
      const timestamp = new Date('2026-01-28T23:59:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T20:00:00.000Z');
    });

    test('should handle edge case: exactly at block boundary (05:00)', () => {
      const timestamp = new Date('2026-01-28T05:00:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T05:00:00.000Z');
    });

    test('should handle day rollover (23:59 to 00:00)', () => {
      const timestamp = new Date('2026-01-28T23:59:59.999Z').getTime();
      const blockId = getActiveBlockId(timestamp);
      expect(blockId).toBe('2026-01-28T20:00:00.000Z');

      const nextDay = new Date('2026-01-29T00:00:00.000Z').getTime();
      const nextBlockId = getActiveBlockId(nextDay);
      expect(nextBlockId).toBe('2026-01-29T00:00:00.000Z');
    });
  });

  describe('getBlockStartTime()', () => {
    test('should return start of block (00:00) for time in first block', () => {
      const timestamp = new Date('2026-01-28T02:30:00.000Z').getTime();
      const startTime = getBlockStartTime(timestamp);

      const expectedStart = new Date('2026-01-28T00:00:00.000Z').getTime();
      expect(startTime).toBe(expectedStart);
    });

    test('should return start of block (15:00) for time in fourth block', () => {
      const timestamp = new Date('2026-01-28T17:00:00.000Z').getTime();
      const startTime = getBlockStartTime(timestamp);

      const expectedStart = new Date('2026-01-28T15:00:00.000Z').getTime();
      expect(startTime).toBe(expectedStart);
    });

    test('should handle time exactly at block start', () => {
      const timestamp = new Date('2026-01-28T10:00:00.000Z').getTime();
      const startTime = getBlockStartTime(timestamp);

      expect(startTime).toBe(timestamp);
    });
  });

  describe('getBlockEndTime()', () => {
    test('should return end time 5 hours after start (00:00 block ends at 05:00)', () => {
      const timestamp = new Date('2026-01-28T02:00:00.000Z').getTime();
      const endTime = getBlockEndTime(timestamp);

      const expectedEnd = new Date('2026-01-28T05:00:00.000Z').getTime();
      expect(endTime).toBe(expectedEnd);
    });

    test('should return end time 5 hours after start (15:00 block ends at 20:00)', () => {
      const timestamp = new Date('2026-01-28T17:00:00.000Z').getTime();
      const endTime = getBlockEndTime(timestamp);

      const expectedEnd = new Date('2026-01-28T20:00:00.000Z').getTime();
      expect(endTime).toBe(expectedEnd);
    });

    test('should handle day rollover (20:00 block ends at 01:00 next day)', () => {
      const timestamp = new Date('2026-01-28T22:00:00.000Z').getTime();
      const endTime = getBlockEndTime(timestamp);

      const expectedEnd = new Date('2026-01-29T01:00:00.000Z').getTime();
      expect(endTime).toBe(expectedEnd);
    });
  });

  describe('isBlockActive()', () => {
    test('should return true if blockId matches current block', () => {
      const now = new Date('2026-01-28T12:30:00.000Z').getTime();
      const blockId = '2026-01-28T10:00:00.000Z';

      const active = isBlockActive(blockId, now);
      expect(active).toBe(true);
    });

    test('should return false if blockId is from past block', () => {
      const now = new Date('2026-01-28T12:30:00.000Z').getTime();
      const blockId = '2026-01-28T05:00:00.000Z'; // Previous block

      const active = isBlockActive(blockId, now);
      expect(active).toBe(false);
    });

    test('should return false if blockId is from future block', () => {
      const now = new Date('2026-01-28T12:30:00.000Z').getTime();
      const blockId = '2026-01-28T15:00:00.000Z'; // Next block

      const active = isBlockActive(blockId, now);
      expect(active).toBe(false);
    });

    test('should use current time if timestamp not provided', () => {
      // This test depends on current system time, so just check it doesn't throw
      const blockId = getActiveBlockId(Date.now());
      expect(() => isBlockActive(blockId)).not.toThrow();
    });
  });

  describe('getBlockProgress()', () => {
    test('should return 0 at start of block', () => {
      const blockId = '2026-01-28T10:00:00.000Z';
      const now = new Date('2026-01-28T10:00:00.000Z').getTime();

      const progress = getBlockProgress(blockId, now);
      expect(progress).toBe(0);
    });

    test('should return 0.5 at middle of block (2.5 hours in)', () => {
      const blockId = '2026-01-28T10:00:00.000Z';
      const now = new Date('2026-01-28T12:30:00.000Z').getTime();

      const progress = getBlockProgress(blockId, now);
      expect(progress).toBe(0.5);
    });

    test('should return 1.0 at end of block', () => {
      const blockId = '2026-01-28T10:00:00.000Z';
      const now = new Date('2026-01-28T15:00:00.000Z').getTime();

      const progress = getBlockProgress(blockId, now);
      expect(progress).toBe(1.0);
    });

    test('should return > 1.0 after block ends', () => {
      const blockId = '2026-01-28T10:00:00.000Z';
      const now = new Date('2026-01-28T16:00:00.000Z').getTime();

      const progress = getBlockProgress(blockId, now);
      expect(progress).toBeGreaterThan(1.0);
    });

    test('should handle fractional progress correctly', () => {
      const blockId = '2026-01-28T10:00:00.000Z';
      const now = new Date('2026-01-28T11:00:00.000Z').getTime(); // 1 hour in

      const progress = getBlockProgress(blockId, now);
      expect(progress).toBe(0.2); // 1 hour / 5 hours = 0.2
    });
  });

  describe('edge cases', () => {
    test('should handle leap years correctly', () => {
      const timestamp = new Date('2024-02-29T12:00:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);

      expect(blockId).toBe('2024-02-29T10:00:00.000Z');
    });

    test('should handle different timezones (always use UTC)', () => {
      // Even if local time is different, should use UTC
      const timestamp = new Date('2026-01-28T12:00:00.000Z').getTime();
      const blockId = getActiveBlockId(timestamp);

      expect(blockId).toContain('T10:00:00.000Z');
    });

    test('should handle invalid timestamps gracefully', () => {
      const invalidTimestamp = NaN;
      expect(() => getActiveBlockId(invalidTimestamp)).not.toThrow();
    });
  });
});
