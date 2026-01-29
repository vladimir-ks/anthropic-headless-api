/**
 * Health Calculator
 *
 * Calculates subscription health scores (0-100, higher = healthier).
 * Algorithm based on PSEUDOCODE.md specification.
 */

import type { Subscription, PoolConfig, HealthScoreBreakdown } from '../types';

export class HealthCalculator {
  // Constants from pseudocode
  private readonly WEEKLY_WEIGHT = 0.5;
  private readonly BLOCK_WEIGHT = 0.3;
  private readonly CLIENT_PENALTY = 5;
  private readonly BURN_RATE_BASELINE = 3.0;
  private readonly BURN_RATE_MULTIPLIER = 2.0;
  private readonly IDLE_BONUS = 10;
  private readonly EXPECTED_BLOCK_COST = 25.0; // $5/hour * 5 hours

  constructor(private config: PoolConfig) {}

  /**
   * Calculate health score for a subscription
   * Returns: 0-100 (higher = healthier)
   */
  calculate(subscription: Subscription): number {
    let score = 100;

    // Factor 1: Weekly budget usage
    const weeklyPercent = (subscription.weeklyUsed / subscription.weeklyBudget) * 100;
    const weeklyPenalty = weeklyPercent * this.WEEKLY_WEIGHT;
    score -= weeklyPenalty;

    // Factor 2: Current block usage
    const blockPercent = this.calculateBlockPercentage(subscription);
    const blockPenalty = blockPercent * this.BLOCK_WEIGHT;
    score -= blockPenalty;

    // Factor 3: Client count
    const clientPenalty = subscription.assignedClients.length * this.CLIENT_PENALTY;
    score -= clientPenalty;

    // Factor 4: Burn rate (only penalize if above baseline)
    if (subscription.burnRate > this.BURN_RATE_BASELINE) {
      const burnRatePenalty =
        (subscription.burnRate - this.BURN_RATE_BASELINE) * this.BURN_RATE_MULTIPLIER;
      score -= burnRatePenalty;
    }

    // Factor 5: Idle bonus (no current block cost)
    if (subscription.currentBlockCost === 0) {
      score += this.IDLE_BONUS;
    }

    // Clamp to 0-100 range
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Explain health score calculation with detailed breakdown
   */
  explainScore(subscription: Subscription): HealthScoreBreakdown {
    const components = {
      weeklyUsagePenalty: 0,
      blockUsagePenalty: 0,
      clientCountPenalty: 0,
      burnRatePenalty: 0,
      idleBonus: 0,
    };

    const explanation: string[] = ['Base score: 100'];

    // Weekly usage penalty
    const weeklyPercent = (subscription.weeklyUsed / subscription.weeklyBudget) * 100;
    components.weeklyUsagePenalty = -(weeklyPercent * this.WEEKLY_WEIGHT);
    explanation.push(
      `Weekly usage (${Math.round(weeklyPercent)}%): ${components.weeklyUsagePenalty.toFixed(1)} points (${Math.round(weeklyPercent)} * ${this.WEEKLY_WEIGHT})`
    );

    // Block usage penalty
    const blockPercent = this.calculateBlockPercentage(subscription);
    components.blockUsagePenalty = -(blockPercent * this.BLOCK_WEIGHT);
    explanation.push(
      `Block usage (${Math.round(blockPercent)}%): ${components.blockUsagePenalty.toFixed(1)} points (${Math.round(blockPercent)} * ${this.BLOCK_WEIGHT})`
    );

    // Client count penalty
    components.clientCountPenalty = -(subscription.assignedClients.length * this.CLIENT_PENALTY);
    explanation.push(
      `Assigned clients (${subscription.assignedClients.length}): ${components.clientCountPenalty} points (${subscription.assignedClients.length} * ${this.CLIENT_PENALTY})`
    );

    // Burn rate penalty
    if (subscription.burnRate > this.BURN_RATE_BASELINE) {
      components.burnRatePenalty =
        -((subscription.burnRate - this.BURN_RATE_BASELINE) * this.BURN_RATE_MULTIPLIER);
      explanation.push(
        `Burn rate (${subscription.burnRate.toFixed(1)} USD/h): ${components.burnRatePenalty.toFixed(1)} points ((${subscription.burnRate.toFixed(1)} - ${this.BURN_RATE_BASELINE}) * ${this.BURN_RATE_MULTIPLIER})`
      );
    }

    // Idle bonus
    if (subscription.currentBlockCost === 0) {
      components.idleBonus = this.IDLE_BONUS;
      explanation.push(`Idle bonus: +${this.IDLE_BONUS} points`);
    }

    const finalScore = this.calculate(subscription);
    explanation.push(`Final score: ${finalScore.toFixed(1)}`);

    return {
      finalScore,
      components,
      explanation,
    };
  }

  /**
   * Calculate block usage percentage
   */
  private calculateBlockPercentage(subscription: Subscription): number {
    if (subscription.currentBlockId === null) {
      return 0;
    }

    if (subscription.currentBlockCost === 0) {
      return 0;
    }

    const blockPercent = (subscription.currentBlockCost / this.EXPECTED_BLOCK_COST) * 100;

    // Cap at 100%
    return Math.min(100, blockPercent);
  }
}
