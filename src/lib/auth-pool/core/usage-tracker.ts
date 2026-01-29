/**
 * Usage Tracker
 *
 * Tracks usage from Claude CLI JSON output.
 * Based on PSEUDOCODE.md specification.
 */

import type { StorageInterface } from '../storage/storage-interface';
import type { UsageRecord, BlockInfo, Subscription } from '../types';
import { validateUsageRecord } from '../utils/validators';
import { getActiveBlockId, getBlockStartTime, getBlockEndTime } from '../utils/block-calculator';
import { createModuleLogger } from '../utils/logger';

const logger = createModuleLogger('UsageTracker');

// Claude CLI JSON output interface (from existing types)
interface ClaudeCliJsonOutput {
  result: string;
  session_id: string;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  modelUsage?: Array<{
    model: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }>;
  uuid: string;
  is_error: boolean;
}

export class UsageTracker {
  constructor(private storage: StorageInterface) {}

  /**
   * Record usage from Claude CLI JSON output
   */
  async recordUsage(
    response: ClaudeCliJsonOutput,
    subscriptionId: string
  ): Promise<UsageRecord> {
    const timestamp = Date.now();

    // Extract usage data from CLI response
    const usageRecord: UsageRecord = {
      subscriptionId,
      timestamp,
      blockId: this.getActiveBlockId(timestamp),
      costUSD: response.total_cost_usd,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens,
      totalTokens:
        response.usage.input_tokens +
        response.usage.output_tokens +
        response.usage.cache_creation_input_tokens +
        response.usage.cache_read_input_tokens,
      modelUsage: response.modelUsage,
      sessionId: response.session_id,
      durationMs: response.duration_ms,
      uuid: response.uuid,
    };

    // Validate
    const validated = validateUsageRecord(usageRecord);

    // Store usage record
    const storageKey = `usage:${subscriptionId}:${timestamp}`;
    await this.storage.set(storageKey, validated);

    // Add to daily index
    const dateKey = this.formatDate(timestamp);
    await this.storage.addToIndex(`index:usage_by_day:${dateKey}`, subscriptionId);

    // Update subscription state
    await this.updateSubscriptionFromUsage(subscriptionId, validated);

    logger.info(`Recorded usage: $${validated.costUSD.toFixed(3)}`, {
      subscriptionId,
      blockId: validated.blockId,
      totalTokens: validated.totalTokens,
    });

    return validated;
  }

  /**
   * Get weekly usage for a subscription (last 7 days)
   */
  async getWeeklyUsage(subscriptionId: string): Promise<number> {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const records = await this.getUsageRecordsSince(subscriptionId, sevenDaysAgo);

    let totalCost = 0;
    for (const record of records) {
      totalCost += record.costUSD;
    }

    return totalCost;
  }

  /**
   * Get active block info for a subscription
   */
  async getActiveBlock(subscriptionId: string): Promise<BlockInfo | null> {
    const timestamp = Date.now();
    const blockId = this.getActiveBlockId(timestamp);

    // Get usage records for this block
    const blockRecords = await this.getUsageRecordsForBlock(subscriptionId, blockId);

    if (blockRecords.length === 0) {
      return null;
    }

    // Aggregate block data
    let totalCost = 0;
    let totalTokens = 0;
    const requestCount = blockRecords.length;

    for (const record of blockRecords) {
      totalCost += record.costUSD;
      totalTokens += record.totalTokens;
    }

    // Calculate burn rate
    const blockStartTime = getBlockStartTime(timestamp);
    const elapsedMs = Date.now() - blockStartTime;
    const elapsedMinutes = elapsedMs / (60 * 1000);

    const tokensPerMinute = elapsedMinutes > 0 ? totalTokens / elapsedMinutes : 0;
    const costPerHour = elapsedMinutes > 0 ? (totalCost / elapsedMinutes) * 60 : 0;

    // Project end-of-block cost
    const totalMinutesInBlock = 5 * 60; // 5 hours
    const remainingMinutes = totalMinutesInBlock - elapsedMinutes;
    const projectedCost = totalCost + costPerHour * (remainingMinutes / 60);

    return {
      id: blockId,
      startTime: getBlockStartTime(timestamp),
      endTime: getBlockEndTime(timestamp),
      isActive: true,
      totalCost,
      totalTokens,
      requestCount,
      tokensPerMinute,
      costPerHour,
      projectedCost,
      remainingMinutes,
    };
  }

  /**
   * Get active block ID for a timestamp
   * Delegates to block-calculator utility
   */
  getActiveBlockId(timestamp: number): string {
    return getActiveBlockId(timestamp);
  }

  /**
   * Calculate burn rate (USD/hour) from last hour of usage
   */
  async calculateBurnRate(subscriptionId: string): Promise<number> {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentRecords = await this.getUsageRecordsSince(subscriptionId, oneHourAgo);

    if (recentRecords.length === 0) {
      return 0;
    }

    let totalCost = 0;
    for (const record of recentRecords) {
      totalCost += record.costUSD;
    }

    // Burn rate = cost per hour (already a 1-hour window)
    return totalCost;
  }

  /**
   * Update subscription state after recording usage
   */
  private async updateSubscriptionFromUsage(
    subscriptionId: string,
    usage: UsageRecord
  ): Promise<void> {
    const subscription = await this.storage.get<Subscription>(`subscription:${subscriptionId}`);

    if (!subscription) {
      logger.error(`Subscription not found`, undefined, { subscriptionId });
      return;
    }

    const currentBlockId = this.getActiveBlockId(Date.now());

    // Check if we're in a new block
    if (subscription.currentBlockId !== currentBlockId) {
      // New block started - reset block cost
      subscription.currentBlockId = currentBlockId;
      subscription.currentBlockCost = usage.costUSD;
      subscription.blockStartTime = getBlockStartTime(Date.now());
      subscription.blockEndTime = getBlockEndTime(Date.now());
    } else {
      // Same block - accumulate cost
      subscription.currentBlockCost += usage.costUSD;
    }

    // Update weekly total
    subscription.weeklyUsed = await this.getWeeklyUsage(subscriptionId);

    // Update burn rate
    subscription.burnRate = await this.calculateBurnRate(subscriptionId);

    // Update tokens per minute (from recent records)
    subscription.tokensPerMinute = await this.calculateTokensPerMinute(subscriptionId);

    // Update status based on usage
    const weeklyPercent = subscription.weeklyUsed / subscription.weeklyBudget;

    if (weeklyPercent >= 0.95) {
      subscription.status = 'limited';
    } else if (weeklyPercent >= 0.8) {
      subscription.status = 'approaching';
    } else {
      subscription.status = 'available';
    }

    subscription.lastUsageUpdate = Date.now();
    subscription.lastRequestTime = Date.now();

    // Persist
    await this.storage.set(`subscription:${subscriptionId}`, subscription);
  }

  /**
   * Get usage records since a timestamp
   */
  private async getUsageRecordsSince(
    subscriptionId: string,
    since: number
  ): Promise<UsageRecord[]> {
    const prefix = `usage:${subscriptionId}:`;
    const allKeys = await this.storage.list(prefix);

    const records: UsageRecord[] = [];

    for (const key of allKeys) {
      // Extract timestamp from key (usage:sub1:1738070000000)
      const parts = key.split(':');
      const recordTimestamp = parseInt(parts[2], 10);

      if (recordTimestamp >= since) {
        const record = await this.storage.get<UsageRecord>(key);
        if (record) {
          records.push(record);
        }
      }
    }

    return records;
  }

  /**
   * Get usage records for a specific block
   */
  private async getUsageRecordsForBlock(
    subscriptionId: string,
    blockId: string
  ): Promise<UsageRecord[]> {
    const blockStartTime = new Date(blockId).getTime();
    const blockEndTime = blockStartTime + 5 * 60 * 60 * 1000; // 5 hours

    const allRecords = await this.getUsageRecordsSince(subscriptionId, blockStartTime);

    const blockRecords: UsageRecord[] = [];

    for (const record of allRecords) {
      if (record.timestamp >= blockStartTime && record.timestamp < blockEndTime) {
        blockRecords.push(record);
      }
    }

    return blockRecords;
  }

  /**
   * Calculate tokens per minute from last 5 minutes
   */
  private async calculateTokensPerMinute(subscriptionId: string): Promise<number> {
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    const recentRecords = await this.getUsageRecordsSince(subscriptionId, fiveMinutesAgo);

    if (recentRecords.length === 0) {
      return 0;
    }

    let totalTokens = 0;
    for (const record of recentRecords) {
      totalTokens += record.totalTokens;
    }

    return totalTokens / 5; // Tokens per minute
  }

  /**
   * Format date as YYYYMMDD for daily index
   */
  private formatDate(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }
}
