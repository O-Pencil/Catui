/**
 * [WHO]: TeachRuntime - core teaching state machine
 * [FROM]: Depends on teach-types.ts, teach-prompts.ts, teach-persistence.ts, teach-i18n.ts
 * [TO]: Consumed by index.ts
 * [HERE]: extensions/builtin/teach/teach-runtime.ts - teaching logic and state management
 */

import type { ExtensionCommandContext } from "../../../core/extensions-host/types.js";
import { teachText, detectTeachLocale, type TeachLocale } from "./teach-i18n.js";
import {
	missionDiscoveryPrompt,
	learningStylePrompt,
	hookPrompt,
	level1Prompt,
	level2Prompt,
	level3Prompt,
	bridgePrompt,
	takeawaysPrompt,
	feynmanCheckPrompt,
	checkpointPrompt,
	completionPrompt,
} from "./teach-prompts.js";
import { TeachPersistence } from "./teach-persistence.js";
import type {
	Analogy,
	LearningStyle,
	LearnerLevel,
	LessonLevel,
	Mission,
	Source,
	TeachLessonOptions,
	TeachResult,
	TeachState,
} from "./teach-types.js";

export class TeachRuntime {
	private state: TeachState | null = null;
	private persistence: TeachPersistence | null = null;
	private locale: TeachLocale = "en";

	/**
	 * Initialize the runtime with workspace path
	 */
	initialize(workspacePath: string): void {
		this.persistence = new TeachPersistence(workspacePath);
		this.locale = detectTeachLocale();
	}

	/**
	 * Start teaching a new topic
	 */
	async startTeaching(ctx: ExtensionCommandContext, topic: string): Promise<TeachResult> {
		if (!this.persistence) {
			return {
				type: "error",
				message: "Teach runtime not initialized",
			};
		}

		// Initialize state
		this.state = {
			phase: "mission_discovery",
			topic,
			learnerLevel: "L0",
			currentLevel: 0,
			glossary: new Map(),
			sources: [],
			learningRecords: [],
		};

		// Load existing progress
		const existingRecords = await this.persistence.loadLearningRecords(topic);
		if (existingRecords.length > 0) {
			this.state.learningRecords = existingRecords;
			// Infer learner level from existing records
			this.state.learnerLevel = this.inferLearnerLevel(existingRecords);
		}

		// Load existing mission
		const existingMission = await this.persistence.loadMission(topic);
		if (existingMission) {
			this.state.mission = existingMission;
			this.state.phase = "learning_style";
			return {
				type: "question",
				message: this.buildResumeMessage(topic, existingMission),
				options: ["quick_overview", "deep_dive", "focused_skill", "holistic"],
				state: this.getStateSnapshot(),
			};
		}

		// Start mission discovery
		return {
			type: "question",
			message: missionDiscoveryPrompt(topic, this.locale),
			state: this.getStateSnapshot(),
		};
	}

	/**
	 * Process user response and advance the teaching flow
	 */
	async processResponse(ctx: ExtensionCommandContext, response: string): Promise<TeachResult> {
		if (!this.state || !this.persistence) {
			return {
				type: "error",
				message: "No active teaching session",
			};
		}

		switch (this.state.phase) {
			case "mission_discovery":
				return await this.processMissionResponse(response);
			case "learning_style":
				return await this.processLearningStyleResponse(response);
			case "teaching":
				return await this.processTeachingResponse(response);
			case "progress_tracking":
				return await this.processProgressResponse(response);
			default:
				return {
					type: "error",
					message: "Invalid teaching phase",
				};
		}
	}

	/**
	 * Process mission discovery response
	 */
	private async processMissionResponse(response: string): Promise<TeachResult> {
		// Parse mission from response
		const mission = this.parseMission(response);
		this.state!.mission = mission;

		// Save mission
		await this.persistence!.saveMission(this.state!.topic, mission);

		// Move to learning style selection
		this.state!.phase = "learning_style";

		return {
			type: "question",
			message: learningStylePrompt(this.locale),
			options: ["quick_overview", "deep_dive", "focused_skill", "holistic"],
			state: this.getStateSnapshot(),
		};
	}

	/**
	 * Process learning style response
	 */
	private async processLearningStyleResponse(response: string): Promise<TeachResult> {
		const style = this.parseLearningStyle(response);
		if (!style) {
			return {
				type: "error",
				message: teachText(this.locale).errorInvalidStyle,
			};
		}

		this.state!.learningStyle = style;
		this.state!.phase = "teaching";
		this.state!.currentLevel = 0;

		// Start with Level 0 (Hook)
		return await this.teachNextLevel();
	}

	/**
	 * Process teaching response
	 */
	private async processTeachingResponse(response: string): Promise<TeachResult> {
		// Check if user wants to continue or stop
		const lowerResponse = response.toLowerCase();
		const stopKeywords = ["stop", "enough", "quit", "exit", "够了", "停", "结束"];
		const depthKeywords = ["deeper", "more", "深入", "继续", "详细"];

		if (stopKeywords.some((kw) => lowerResponse.includes(kw))) {
			return await this.completeTeaching();
		}

		if (depthKeywords.some((kw) => lowerResponse.includes(kw))) {
			// User wants more depth, continue to next level
			return await this.teachNextLevel();
		}

		// Check if user is asking a question
		if (response.includes("?") || response.includes("？") || lowerResponse.startsWith("what") || lowerResponse.startsWith("how") || lowerResponse.startsWith("why")) {
			// Handle as a question within current context
			return {
				type: "info",
				message: `Great question! Let me explain that in the context of ${this.state!.topic}...\n\n${this.generateAnswerForQuestion(response)}`,
			};
		}

		// Default: continue teaching
		return await this.teachNextLevel();
	}

	/**
	 * Process progress response
	 */
	private async processProgressResponse(response: string): Promise<TeachResult> {
		// User can choose to continue or end
		const lowerResponse = response.toLowerCase();
		const continueKeywords = ["continue", "more", "next", "继续", "下一个"];

		if (continueKeywords.some((kw) => lowerResponse.includes(kw))) {
			// Start a new topic or go deeper
			return {
				type: "question",
				message: "What would you like to learn next?",
			};
		}

		return {
			type: "complete",
			message: completionPrompt(this.state!.topic, this.locale),
			state: this.getStateSnapshot(),
		};
	}

	/**
	 * Teach the next level
	 */
	private async teachNextLevel(): Promise<TeachResult> {
		const { topic, currentLevel, learnerLevel, learningStyle } = this.state!;

		// Check if we've reached the end
		if (currentLevel > 3) {
			return await this.completeTeaching();
		}

		// Find analogy for this topic and level
		const analogy = await this.findAnalogy(topic, currentLevel);

		// Verify sources
		const sources = await this.verifySources(topic, currentLevel);
		this.state!.sources = sources;

		// Build lesson options
		const lessonOptions: TeachLessonOptions = {
			topic,
			level: currentLevel as LessonLevel,
			analogy,
			sources,
			learnerLevel,
			learningStyle: learningStyle ?? "quick_overview",
		};

		// Generate content based on level
		let content: string;
		switch (currentLevel) {
			case 0:
				content = hookPrompt(lessonOptions, this.locale);
				break;
			case 1:
				content = level1Prompt(lessonOptions, this.locale);
				break;
			case 2:
				content = level2Prompt(lessonOptions, this.locale);
				break;
			case 3:
				content = level3Prompt(lessonOptions, this.locale);
				break;
			default:
				content = hookPrompt(lessonOptions, this.locale);
		}

		// Add bridge and takeaways for final level
		if (currentLevel === 3 || (learningStyle === "quick_overview" && currentLevel === 1)) {
			content += "\n\n" + bridgePrompt(topic, this.locale);
			content += "\n\n" + takeawaysPrompt(topic, this.locale);
			content += feynmanCheckPrompt(this.locale);
		}

		// Save learning record
		await this.persistence!.saveLearningRecord({
			topic,
			level: currentLevel as LessonLevel,
			content,
			timestamp: new Date(),
			status: "active",
		});

		// Determine next action
		const nextAction = this.getNextAction();

		// Move to next level
		this.state!.currentLevel++;

		// Add checkpoint if needed
		let checkpoint = "";
		if (nextAction === "ask") {
			checkpoint = checkpointPrompt("digest", this.locale);
		} else if (nextAction === "continue") {
			checkpoint = checkpointPrompt("continue", this.locale);
		}

		return {
			type: "lesson",
			message: content + checkpoint,
			level: (this.state!.currentLevel - 1) as LessonLevel,
			nextAction,
			state: this.getStateSnapshot(),
		};
	}

	/**
	 * Complete the teaching session
	 */
	private async completeTeaching(): Promise<TeachResult> {
		this.state!.phase = "progress_tracking";

		// Save final progress
		await this.persistence!.saveGlossary(this.state!.glossary);

		return {
			type: "complete",
			message: completionPrompt(this.state!.topic, this.locale),
			state: this.getStateSnapshot(),
		};
	}

	/**
	 * Get the next action based on learning style and current level
	 */
	private getNextAction(): "continue" | "ask" | "complete" {
		const { currentLevel, learningStyle } = this.state!;

		if (currentLevel >= 3) {
			return "complete";
		}

		switch (learningStyle) {
			case "quick_overview":
				return currentLevel >= 1 ? "ask" : "continue";
			case "deep_dive":
				return "continue";
			case "focused_skill":
				return currentLevel >= 2 ? "ask" : "continue";
			case "holistic":
				return "continue";
			default:
				return "continue";
		}
	}

	/**
	 * Find an analogy for the topic
	 */
	private async findAnalogy(topic: string, level: number): Promise<Analogy | null> {
		// In a real implementation, this would search the analogy library
		// For now, return a generic analogy
		return {
			concept: topic,
			analogy: `Think of ${topic} like learning a new skill - it takes practice and patience`,
			details: "This analogy helps you understand the learning process itself",
			confidence: "medium",
		};
	}

	/**
	 * Verify sources for the topic
	 */
	private async verifySources(topic: string, level: number): Promise<Source[]> {
		// In a real implementation, this would search for and verify sources
		// For now, return placeholder sources
		return [
			{
				name: "Official Documentation",
				url: "https://example.com/docs",
				confidence: 5,
				verificationMethod: "Official source",
			},
		];
	}

	/**
	 * Parse mission from user response
	 */
	private parseMission(response: string): Mission {
		// Simple parsing - in a real implementation, use NLP or structured input
		const lines = response.split("\n").filter((line) => line.trim());

		return {
			why: lines[0] ?? response,
			successCriteria: lines.slice(1, 3).map((l) => l.replace(/^[-*]\s*/, "")),
			constraints: [],
			outOfScope: [],
		};
	}

	/**
	 * Parse learning style from user response
	 */
	private parseLearningStyle(response: string): LearningStyle | null {
		const lower = response.toLowerCase();

		if (lower.includes("quick") || lower.includes("1") || lower.includes("快速")) {
			return "quick_overview";
		}
		if (lower.includes("deep") || lower.includes("2") || lower.includes("深入")) {
			return "deep_dive";
		}
		if (lower.includes("focus") || lower.includes("3") || lower.includes("单点")) {
			return "focused_skill";
		}
		if (lower.includes("holistic") || lower.includes("4") || lower.includes("系统")) {
			return "holistic";
		}

		return null;
	}

	/**
	 * Infer learner level from existing records
	 */
	private inferLearnerLevel(records: import("./teach-types.js").LearningRecord[]): LearnerLevel {
		const maxLevel = Math.max(...records.map((r) => r.level));

		if (maxLevel >= 3) return "L3";
		if (maxLevel >= 2) return "L2";
		if (maxLevel >= 1) return "L1";
		return "L0";
	}

	/**
	 * Build resume message
	 */
	private buildResumeMessage(topic: string, mission: Mission): string {
		return [
			`Welcome back! We were learning about **${topic}**.`,
			"",
			`**Mission**: ${mission.why}`,
			"",
			"Would you like to continue where we left off?",
			"",
			learningStylePrompt(this.locale),
		].join("\n");
	}

	/**
	 * Generate answer for a question
	 */
	private generateAnswerForQuestion(question: string): string {
		// In a real implementation, this would use the LLM to generate an answer
		return `That's a great question about ${this.state!.topic}. Let me break it down for you...`;
	}

	/**
	 * Get current state snapshot
	 */
	private getStateSnapshot(): Partial<TeachState> {
		if (!this.state) return {};
		return {
			phase: this.state.phase,
			topic: this.state.topic,
			learnerLevel: this.state.learnerLevel,
			currentLevel: this.state.currentLevel,
			learningStyle: this.state.learningStyle,
		};
	}

	/**
	 * Get current state
	 */
	getState(): TeachState | null {
		return this.state;
	}

	/**
	 * Reset state
	 */
	reset(): void {
		this.state = null;
	}
}
