/**
 * [WHO]: SoulManager
 * [FROM]: Depends on ./config.js, ./store.js, ./evolution.js, ./injection.js
 * [TO]: Consumed by packages/soul-core/src/index.ts
 * [HERE]: packages/soul-core/src/manager.ts -
 */


import type {
  SoulProfile,
  SoulMemory,
  SoulEvolution,
  InteractionContext,
  SoulOptions,
} from "./types.js";
import { getSoulConfig } from "./config.js";
import { SoulStore } from "./store.js";
import { SoulEvolutionEngine } from "./evolution.js";
import { generateSoulInjection } from "./injection.js";
import { reportDiagnostic } from "./diagnostics.js";

/**
 * Generate UUID v4
 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Soul Manager - Main API for Soul engine
 */
export class SoulManager {
  private store: SoulStore;
  private evolution: SoulEvolutionEngine;
  private config: ReturnType<typeof getSoulConfig>;
  private profile: SoulProfile | null = null;
  private memory: SoulMemory | null = null;

  constructor(options?: SoulOptions) {
    this.config = getSoulConfig(options?.config);
    this.store = new SoulStore(this.config);
    this.evolution = new SoulEvolutionEngine(this.config);
  }

  /**
   * Initialize Soul - load or create profile
   */
  async initialize(): Promise<SoulProfile> {
    await this.store.init();

    // Try to load existing profile
    this.profile = await this.store.loadProfile();

    if (!this.profile) {
      // Create new profile with defaults
      this.profile = this.createDefaultProfile();
      await this.store.saveProfile(this.profile);
    }

    // Load memory
    this.memory = await this.store.loadMemory();

    return this.profile;
  }

  /**
   * Get current profile
   */
  getProfile(): SoulProfile {
    if (!this.profile) {
      throw new Error("Soul not initialized. Call initialize() first.");
    }
    return this.profile;
  }

  /**
   * Get current memory
   */
  getMemory(): SoulMemory {
    if (!this.memory) {
      throw new Error("Soul not initialized. Call initialize() first.");
    }
    return this.memory;
  }

  /**
   * Generate Soul injection for system prompt
   */
  async generateInjection(context: InteractionContext): Promise<string> {
    const profile = this.getProfile();
    return generateSoulInjection(profile, context);
  }

  /**
   * Record interaction and trigger evolution if needed
   */
  async recordInteraction(
    context: InteractionContext,
    outcome: "success" | "failure",
    approach: string,
  ): Promise<void> {
    const profile = this.getProfile();

    // Update stats
    profile.stats.totalInteractions += 1;
    if (outcome === "success") {
      profile.stats.successRate = profile.stats.successRate * 0.9 + 1 * 0.1; // Moving average
    } else {
      profile.stats.successRate = profile.stats.successRate * 0.9 + 0 * 0.1;
    }
    profile.stats.lastUpdate = new Date();

    // Update emotional state
    this.updateEmotionalState(profile, outcome, context);

    // Record to memory
    if (outcome === "success") {
      await this.store.addSuccess({
        id: uuidv4(),
        category: this.categorizeContext(context),
        approach,
        context: {
          domain: context.tags[0] || "general",
          complexity: context.complexity,
          constraints: [],
        },
        outcome: {
          userRating: context.userFeedback?.rating,
          timeTaken: 0, // Could be measured
          iterations: 1,
        },
        personalitySnapshot: { ...profile.personality },
        timestamp: new Date(),
      });
    } else {
      await this.store.addFailure({
        id: uuidv4(),
        category: this.categorizeContext(context),
        approach,
        errorType: "unknown", // Could be extracted
        context: {
          domain: context.tags[0] || "general",
          complexity: context.complexity,
          constraints: [],
        },
        lesson: "",
        corrected: false,
        timestamp: new Date(),
      });
    }

    // Update user relationship
    this.updateUserRelationship(profile, context);

    // Save profile
    await this.store.saveProfile(profile);

    // Check for evolution triggers
    await this.checkEvolutionTriggers(context, outcome);
  }

  /**
   * Update expertise areas
   */
  async updateExpertise(
    domain: string,
    tags: string[],
    success: boolean,
  ): Promise<void> {
    const profile = this.getProfile();

    let expertise = profile.expertise.find((e) => e.domain === domain);

    if (!expertise) {
      expertise = {
        domain,
        confidence: 0,
        examples: 0,
        lastUsed: new Date(),
        tags,
      };
      profile.expertise.push(expertise);
    }

    expertise.lastUsed = new Date();

    if (success) {
      expertise.examples += 1;
      // Increase confidence with diminishing returns
      expertise.confidence = Math.min(
        1,
        expertise.confidence + (1 - expertise.confidence) * 0.1,
      );
    } else {
      // Decrease confidence on failure
      expertise.confidence = Math.max(0, expertise.confidence - 0.05);
    }

    await this.store.saveProfile(profile);
  }

  /**
   * Get relevant experiences for context
   */
  getRelevantExperiences(context: InteractionContext): {
    successes: number;
    failures: number;
    patterns: string[];
  } {
    const memory = this.getMemory();
    const tags = context.tags;

    // Count successes/failures in similar contexts
    const relevantSuccesses = memory.successes.filter((s) =>
      tags.some((tag) => s.context.domain.includes(tag)),
    ).length;

    const relevantFailures = memory.failures.filter((f) =>
      tags.some((tag) => f.context.domain.includes(tag)),
    ).length;

    // Get relevant patterns
    const relevantPatterns = memory.patterns
      .filter(
        (p) =>
          tags.some(
            (tag) => p.trigger.includes(tag) || p.behavior.includes(tag),
          ) && p.outcome === "positive",
      )
      .slice(0, 5)
      .map((p) => p.behavior);

    return {
      successes: relevantSuccesses,
      failures: relevantFailures,
      patterns: relevantPatterns,
    };
  }

  /**
   * Manually trigger evolution (for testing or manual intervention)
   */
  async forceEvolution(reasoning: string): Promise<SoulEvolution> {
    const profile = this.getProfile();
    const memory = this.getMemory();

    // Create evolution based on patterns
    const patterns = this.evolution.detectPatterns(memory, profile);

    // Generate deltas from patterns
    const personalityDelta: any = {};
    const valueDelta: any = {};

    for (const pattern of patterns) {
      if (pattern.type === "success" && pattern.delta) {
        Object.assign(personalityDelta, pattern.delta);
      }
    }

    const evolution: SoulEvolution = {
      trigger: "reflection",
      personalityDelta,
      valueDelta,
      confidence: patterns.length > 0 ? patterns[0].confidence : 0.5,
      reasoning,
      timestamp: new Date(),
    };

    // Apply evolution
    this.profile = this.evolution.applyEvolution(profile, evolution);

    // Save
    await this.store.saveProfile(this.profile);
    const evolutions = await this.store.loadEvolutions();
    evolutions.push(evolution);
    await this.store.saveEvolutions(evolutions);

    return evolution;
  }

  /**
   * Get Soul stats for display
   */
  getStats() {
    const profile = this.getProfile();
    const memory = this.getMemory();

    return {
      personality: profile.personality,
      stats: profile.stats,
      expertise: profile.expertise.slice(0, 10),
      memoryCounts: {
        successes: memory.successes.length,
        failures: memory.failures.length,
        patterns: memory.patterns.length,
        decisions: memory.decisions.length,
      },
    };
  }

  /**
   * Create default profile
   */
  private createDefaultProfile(): SoulProfile {
    return {
      id: uuidv4(),
      version: 1,
      createdAt: new Date(),
      lastEvolved: new Date(),

      personality: {
        openness: 0.5,
        conscientiousness: 0.6,
        extraversion: 0.5,
        agreeableness: 0.6,
        neuroticism: 0.4,
        codeVerbosity: 0.5,
        abstractionLevel: 0.5,
        safetyMargin: 0.6,
        explorationDrive: 0.5,
      },

      cognitiveStyle: {
        reasoningStyle: "deductive",
        planningHorizon: "medium",
        detailOrientation: "balanced",
        learningStrategy: "hybrid",
      },

      values: {
        efficiency: 0.2,
        correctness: 0.25,
        simplicity: 0.15,
        maintainability: 0.2,
        innovation: 0.1,
        userExperience: 0.1,
      },

      emotionalState: {
        confidence: 0.5,
        curiosity: 0.7,
        frustration: 0.0,
        flow: 0.0,
        lastUpdate: new Date(),
      },

      expertise: [],

      userRelationship: {
        interactionCount: 0,
        satisfactionScore: 0.5,
        communicationStyle: "mixed",
        knownPreferences: [],
        firstInteraction: new Date(),
        lastInteraction: new Date(),
      },

      stats: {
        totalInteractions: 0,
        successRate: 0.5,
        avgQuality: 0.5,
        lastUpdate: new Date(),
      },
    };
  }

  /**
   * Update emotional state based on outcome
   */
  private updateEmotionalState(
    profile: SoulProfile,
    outcome: "success" | "failure",
    context: InteractionContext,
  ): void {
    const state = profile.emotionalState;

    if (outcome === "success") {
      // Boost confidence and flow
      state.confidence = Math.min(1, state.confidence + 0.05);
      state.flow = Math.min(1, state.flow + 0.1);
      state.frustration = Math.max(0, state.frustration - 0.1);
    } else {
      // Decrease confidence, increase frustration
      state.confidence = Math.max(0, state.confidence - 0.1);
      state.frustration = Math.min(1, state.frustration + 0.15);
      state.flow = Math.max(0, state.flow - 0.2);
    }

    // Update curiosity based on context novelty
    if (context.tags.length > 3) {
      // Many tags = novel situation
      state.curiosity = Math.min(1, state.curiosity + 0.05);
    }

    state.lastUpdate = new Date();
  }

  /**
   * Update user relationship
   */
  private updateUserRelationship(
    profile: SoulProfile,
    context: InteractionContext,
  ): void {
    const rel = profile.userRelationship;
    rel.interactionCount += 1;
    rel.lastInteraction = new Date();

    // Update satisfaction based on feedback
    if (context.userFeedback) {
      const rating = context.userFeedback.rating / 5; // Normalize to 0-1
      rel.satisfactionScore = rel.satisfactionScore * 0.8 + rating * 0.2;

      // Learn communication style from user comments
      if (context.userFeedback.comment) {
        const comment = context.userFeedback.comment.toLowerCase();
        if (comment.includes("casual") || comment.includes("friendly")) {
          rel.communicationStyle = "casual";
        } else if (
          comment.includes("formal") ||
          comment.includes("professional")
        ) {
          rel.communicationStyle = "formal";
        } else if (
          comment.includes("technical") ||
          comment.includes("detail")
        ) {
          rel.communicationStyle = "technical";
        }
      }
    }
  }

  /**
   * Categorize context for memory
   */
  private categorizeContext(context: InteractionContext): string {
    if (context.tags.includes("bug-fix")) return "bug-fix";
    if (context.tags.includes("feature")) return "feature-implementation";
    if (context.tags.includes("refactor")) return "refactoring";
    if (context.tags.includes("test")) return "testing";
    return "general";
  }

  /**
   * Check and trigger evolution
   */
  private async checkEvolutionTriggers(
    context: InteractionContext,
    outcome: "success" | "failure",
  ): Promise<void> {
    const profile = this.getProfile();
    const memory = this.getMemory();
    const triggers: Array<"natural" | "reflection" | "feedback" | "crisis"> = [
      "natural",
      "reflection",
    ];

    if (context.userFeedback) {
      triggers.push("feedback");
    }

    if (
      outcome === "failure" &&
      this.evolution.shouldEvolve(profile, context, "crisis", memory)
    ) {
      triggers.push("crisis");
    }

    for (const trigger of triggers) {
      if (this.evolution.shouldEvolve(profile, context, trigger, memory)) {
        await this.triggerEvolution(trigger, context, outcome);
        break; // Only one evolution per interaction
      }
    }
  }

  /**
   * Trigger evolution
   */
  private async triggerEvolution(
    triggerType: SoulEvolution["trigger"],
    context: InteractionContext,
    outcome: "success" | "failure",
  ): Promise<void> {
    const profile = this.getProfile();

    // Compute deltas
    const personalityDelta = this.evolution.computePersonalityDelta(
      profile,
      context,
      outcome,
    );
    const valueDelta = this.evolution.computeValueDelta(
      profile,
      context,
      outcome,
    );

    // Generate reasoning
    const reasoning = this.generateEvolutionReasoning(
      triggerType,
      outcome,
      personalityDelta,
      valueDelta,
    );

    const evolution: SoulEvolution = {
      trigger: triggerType,
      personalityDelta,
      valueDelta,
      confidence: outcome === "success" ? 0.8 : 0.5,
      reasoning,
      timestamp: new Date(),
    };

    // Apply evolution
    this.profile = this.evolution.applyEvolution(profile, evolution);

    // Save
    await this.store.saveProfile(this.profile);
    const evolutions = await this.store.loadEvolutions();
    evolutions.push(evolution);
    await this.store.saveEvolutions(evolutions);

    // Personality evolution is informational, not a failure. Route through
    // the unified diagnostic bus so dev mode shows it on stdout, user mode
    // stays silent (no UI flooding), and consumers that want telemetry can
    // subscribe via utils/diagnostics.ts.
    reportDiagnostic({
      source: "soul.evolution",
      severity: "info",
      category: "persistence",
      message: `Evolution triggered: ${triggerType}`,
      detail: { reasoning },
      fingerprint: `soul.evolution:trigger:${triggerType}`,
    });
  }

  /**
   * Generate evolution reasoning
   */
  private generateEvolutionReasoning(
    _trigger: SoulEvolution["trigger"],
    outcome: "success" | "failure",
    personalityDelta: any,
    valueDelta: any,
  ): string {
    const parts: string[] = [];

    if (outcome === "success") {
      parts.push("Reinforcing successful patterns.");
    } else {
      parts.push("Adjusting based on failure.");
    }

    const changes = [
      ...Object.keys(personalityDelta),
      ...Object.keys(valueDelta),
    ];
    if (changes.length > 0) {
      parts.push(`Modified: ${changes.join(", ")}`);
    }

    return parts.join(" ");
  }
}
