/**
 * Block Calculator Utilities
 *
 * Handles 5-hour block calculations for Anthropic's billing windows.
 * Blocks start at: 00:00, 05:00, 10:00, 15:00, 20:00 UTC
 */

const BLOCK_DURATION_MS = 5 * 60 * 60 * 1000; // 5 hours
const BLOCK_DURATION_HOURS = 5;

/**
 * Get the block ID for a given timestamp
 * Returns ISO string of block start time (e.g., "2026-01-28T15:00:00.000Z")
 */
export function getActiveBlockId(timestamp: number): string {
  if (isNaN(timestamp)) {
    // Fallback to current time for invalid input
    timestamp = Date.now();
  }

  const date = new Date(timestamp);
  const hour = date.getUTCHours();

  // Calculate block start hour (floor to nearest 5-hour boundary)
  const blockStartHour = Math.floor(hour / BLOCK_DURATION_HOURS) * BLOCK_DURATION_HOURS;

  // Create date at block start
  const blockStart = new Date(date);
  blockStart.setUTCHours(blockStartHour, 0, 0, 0);

  return blockStart.toISOString();
}

/**
 * Get the start time (timestamp) of the block containing the given timestamp
 */
export function getBlockStartTime(timestamp: number): number {
  const blockId = getActiveBlockId(timestamp);
  return new Date(blockId).getTime();
}

/**
 * Get the end time (timestamp) of the block containing the given timestamp
 * Block ends 5 hours after it starts
 */
export function getBlockEndTime(timestamp: number): number {
  const startTime = getBlockStartTime(timestamp);
  return startTime + BLOCK_DURATION_MS;
}

/**
 * Check if a block ID is currently active
 * @param blockId - ISO string of block start time
 * @param currentTimestamp - Optional timestamp to check against (defaults to now)
 */
export function isBlockActive(blockId: string, currentTimestamp?: number): boolean {
  const now = currentTimestamp ?? Date.now();
  const currentBlockId = getActiveBlockId(now);

  return blockId === currentBlockId;
}

/**
 * Get the progress through a block (0.0 = start, 1.0 = end, >1.0 = past end)
 * @param blockId - ISO string of block start time
 * @param currentTimestamp - Optional timestamp to check against (defaults to now)
 */
export function getBlockProgress(blockId: string, currentTimestamp?: number): number {
  const now = currentTimestamp ?? Date.now();
  const blockStartTime = new Date(blockId).getTime();
  const blockEndTime = blockStartTime + BLOCK_DURATION_MS;

  const elapsed = now - blockStartTime;
  const progress = elapsed / BLOCK_DURATION_MS;

  return progress;
}
