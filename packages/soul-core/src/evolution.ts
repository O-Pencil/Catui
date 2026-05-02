/**
 * [WHO]: SoulEvolutionEngine, PatternInsight
 * [FROM]: Depends on soul-core types and config for profile, memory, context, and thresholds
 * [TO]: Consumed by packages/soul-core/src/index.ts
 * [HERE]: packages/soul-core/src/evolution.ts - computes deltas, detects patterns, and gates evolution triggers
 */


import type {
  SoulProfile,
  SoulMemory,
  PersonalityDelta,
  ValueDelta,
  SoulEvolution,
  InteractionContext,
  SuccessMemory,
  FailureMemory,
  PersonalityVector,
} from "./types.js";
import type { SoulConfig } from "./config.js";

/**
 * Soul Evolution Engine
 */
export class SoulEvolutionEngine {
  private config: SoulConfig;
  private readonly crisisWindowMs = 30 * 60 * 1000;

  constructor(config: SoulConfig) {
    this.config = config;
  }

  /**
   * Compute personality delta based on experience
   */
  computePersonalityDelta(
    profile: SoulProfile,
    context: InteractionContext,
    outcome: "success" | "failure",
    previousAttempts?: number,
  ): PersonalityDelta {
    const delta: PersonalityDelta = {};
    const limits = this.config.personalityLimits;

    // Success reinforces current personality
    if (outcome === "success") {
      // Reinforce conscientiousness for quality work
      if (previousAttempts && previousAttempts <= 2) {
        delta.conscientiousness = Math.min(limits.maxDelta, 0.02);
      }

      // Reinforce openness for exploring new approaches
      if (context.tags.includes("innovative")) {
        delta.openness = Math.min(limits.maxDelta, 0.03);
      }

      // Reinforce safety margin for complex tasks
      if (context.complexity > 0.7) {
        delta.safetyMargin = Math.min(limits.maxDelta, 0.02);
      }
    }
    // Failure triggers adjustment
    else {
      // Increase safety margin after failure
      delta.safetyMargin = Math.min(limits.maxDelta, 0.05);

      // Increase conscientiousness (be more careful)
      delta.conscientiousness = Math.min(limits.maxDelta, 0.03);

      // Decrease exploration (stick to known)
      delta.explorationDrive = -Math.min(limits.maxDelta, 0.04);
    }

    // Apply bounds
    return this.applyPersonalityBounds(profile.personality, delta);
  }

  /**
   * Compute value delta based on context and outcome
   */
  computeValueDelta(
    profile: SoulProfile,
    context: InteractionContext,
    outcome: "success" | "failure",
  ): ValueDelta {
    const delta: ValueDelta = {};
    const limits = this.config.valueLimits;

    // Success reinforces values that led to it
    if (outcome === "success") {
      // If quick success, reinforce efficiency
      if (
        context.toolUsage &&
        Object.values(context.toolUsage).reduce((a, b) => a + b, 0) < 5
      ) {
        delta.efficiency = Math.min(limits.maxDelta, 0.05);
      }

      // If user rated highly, reinforce user experience
      if (context.userFeedback && context.userFeedback.rating >= 4) {
        delta.userExperience = Math.min(limits.maxDelta, 0.05);
      }
    }
    // Failure triggers value reconsideration
    else {
      // Increase correctness priority after failure
      delta.correctness = Math.min(limits.maxDelta, 0.05);

      // Decrease innovation (was too risky)
      delta.innovation = -Math.min(limits.maxDelta, 0.03);
    }

    // Apply bounds
    return this.applyValueBounds(profile.values, delta);
  }

  /**
   * Apply personality bounds
   */
  private applyPersonalityBounds(
    personality: SoulProfile["personality"],
    delta: PersonalityDelta,
  ): PersonalityDelta {
    const bounded: PersonalityDelta = {};
    const limits = this.config.personalityLimits;

    for (const [key, value] of Object.entries(delta)) {
      const current = personality[key as keyof PersonalityVector];
      if (current === undefined) continue;

      const newValue = current + (value as number);
      bounded[key as keyof PersonalityDelta] =
        Math.max(limits.min, Math.min(limits.max, newValue)) - current;
    }

    return bounded;
  }

  /**
   * Apply value bounds
   */
  private applyValueBounds(
    values: SoulProfile["values"],
    delta: ValueDelta,
  ): ValueDelta {
    const bounded: ValueDelta = {};
    const limits = this.config.valueLimits;

    for (const [key, value] of Object.entries(delta)) {
      const current = values[key as keyof SoulProfile["values"]];
      if (current === undefined) continue;

      const newValue = current + (value as number);
      bounded[key as keyof ValueDelta] =
        Math.max(limits.min, Math.min(limits.max, newValue)) - current;
    }

    return bounded;
  }

  /**
   * Apply delta to profile
   */
  applyEvolution(profile: SoulProfile, evolution: SoulEvolution): SoulProfile {
    const updated = { ...profile };

    // Apply personality delta
    for (const [key, value] of Object.entries(evolution.personalityDelta)) {
      (updated.personality as any)[key] = Math.max(
        0,
        Math.min(1, (updated.personality as any)[key] + value),
      );
    }

    // Apply value delta
    for (const [key, value] of Object.entries(evolution.valueDelta)) {
      (updated.values as any)[key] = Math.max(
        0,
        Math.min(1, (updated.values as any)[key] + value),
      );
    }

    // Update metadata
    updated.version += 1;
    updated.lastEvolved = evolution.timestamp;

    return updated;
  }

  /**
   * Detect patterns from memory
   */
  detectPatterns(memory: SoulMemory, profile: SoulProfile): PatternInsight[] {
    const insights: PatternInsight[] = [];

    // Analyze successes
    const successfulPatterns = this.analyzeSuccessPatterns(
      memory.successes,
      profile,
    );
    insights.push(...successfulPatterns);

    // Analyze failures
    const failurePatterns = this.analyzeFailurePatterns(memory.failures);
    insights.push(...failurePatterns);

    return insights;
  }

  /**
   * Analyze success patterns
   */
  private analyzeSuccessPatterns(
    successes: SuccessMemory[],
    profile: SoulProfile,
  ): PatternInsight[] {
    const insights: PatternInsight[] = [];

    // Group by category
    const byCategory = new Map<string, SuccessMemory[]>();
    for (const success of successes) {
      if (!byCategory.has(success.category)) {
        byCategory.set(success.category, []);
      }
      byCategory.get(success.category)!.push(success);
    }

    // Find patterns
    for (const [category, items] of byCategory) {
      if (items.length < 3) continue; // Need at least 3 samples

      const avgPersonality = this.averagePersonality(
        items.map((i) => i.personalitySnapshot),
      );
      const delta = this.computePersonalityDiff(
        profile.personality,
        avgPersonality,
      );

      insights.push({
        type: "success",
        category,
        sampleSize: items.length,
        avgPersonality,
        delta,
        confidence: Math.min(1, items.length / 10),
      });
    }

    return insights;
  }

  /**
   * Analyze failure patterns
   */
  private analyzeFailurePatterns(failures: FailureMemory[]): PatternInsight[] {
    const insights: PatternInsight[] = [];

    // Group by error type
    const byError = new Map<string, FailureMemory[]>();
    for (const failure of failures) {
      if (!byError.has(failure.errorType)) {
        byError.set(failure.errorType, []);
      }
      byError.get(failure.errorType)!.push(failure);
    }

    // Find patterns
    for (const [errorType, items] of byError) {
      if (items.length < 2) continue;

      // Check if failures are corrected
      const correctedCount = items.filter((f) => f.corrected).length;
      const recurring = items.length > correctedCount;

      insights.push({
        type: "failure",
        category: errorType,
        sampleSize: items.length,
        recurring,
        correctedRate: correctedCount / items.length,
        recommendation: recurring
          ? `Recurring error: ${errorType}. Consider increasing safetyMargin and conscientiousness.`
          : `Error pattern learned and corrected: ${errorType}`,
        confidence: Math.min(1, items.length / 5),
      });
    }

    return insights;
  }

  /**
   * Average personality snapshots
   */
  private averagePersonality(
    snapshots: SoulProfile["personality"][],
  ): SoulProfile["personality"] {
    const avg: any = {};
    for (const key of Object.keys(snapshots[0]) as Array<
      keyof SoulProfile["personality"]
    >) {
      avg[key] =
        snapshots.reduce((sum, s) => sum + s[key], 0) / snapshots.length;
    }
    return avg;
  }

  /**
   * Compute personality difference
   */
  private computePersonalityDiff(
    current: SoulProfile["personality"],
    target: SoulProfile["personality"],
  ): Partial<SoulProfile["personality"]> {
    const diff: any = {};
    for (const key of Object.keys(current) as Array<
      keyof SoulProfile["personality"]
    >) {
      const delta = target[key] - current[key];
      if (Math.abs(delta) > 0.01) {
        diff[key] = delta;
      }
    }
    return diff;
  }

  /**
   * Check if evolution should be triggered
   */
  shouldEvolve(
    profile: SoulProfile,
    context: InteractionContext,
    triggerType: SoulEvolution["trigger"],
    memory?: SoulMemory,
  ): boolean {
    const triggers = this.config.evolution;

    switch (triggerType) {
      case "natural":
        return profile.stats.totalInteractions % triggers.natural === 0;
      case "reflection":
        return profile.stats.totalInteractions % triggers.reflection === 0;
      case "feedback":
        return context.userFeedback !== undefined;
      case "crisis":
        return this.hasRecentFailureCrisis(
          profile,
          memory,
          triggers.crisis,
          context.timestamp,
        );
      default:
        return false;
    }
  }

  private hasRecentFailureCrisis(
    profile: SoulProfile,
    memory: SoulMemory | undefined,
    threshold: number,
    now: Date,
  ): boolean {
    const requiredFailures = Math.max(1, threshold);
    if (!memory || profile.stats.totalInteractions < requiredFailures) {
      return false;
    }

    const recentFailures = memory.failures
      .filter((failure) => {
        const timestamp = failure.timestamp.getTime();
        return Number.isFinite(timestamp) && timestamp <= now.getTime();
      })
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-requiredFailures);

    if (recentFailures.length < requiredFailures) {
      return false;
    }

    const oldestRecentFailure = recentFailures[0].timestamp.getTime();
    return now.getTime() - oldestRecentFailure <= this.crisisWindowMs;
  }
}

/**
 * Pattern insight from analysis
 */
export interface PatternInsight {
  type: "success" | "failure";
  category: string;
  sampleSize: number;
  avgPersonality?: SoulProfile["personality"];
  delta?: Partial<SoulProfile["personality"]>;
  recurring?: boolean;
  correctedRate?: number;
  recommendation?: string;
  confidence: number;
}
