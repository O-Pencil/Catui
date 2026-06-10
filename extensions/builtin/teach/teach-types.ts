/**
 * [WHO]: TeachTypes - teaching-related type definitions
 * [FROM]: No dependencies
 * [TO]: Consumed by teach-runtime.ts, teach-prompts.ts, teach-format.ts
 * [HERE]: extensions/builtin/teach/teach-types.ts - type definitions for teach extension
 */

export type TeachPhase =
	| "mission_discovery" // 任务发现
	| "learning_style" // 学习风格选择
	| "teaching" // 教学中
	| "progress_tracking"; // 进度追踪

export type LearningStyle =
	| "quick_overview" // 快速概览 (10-15 min)
	| "deep_dive" // 深入学习 (30-60 min)
	| "focused_skill" // 单点突破 (20-30 min)
	| "holistic"; // 系统学习 (多轮对话)

export type LearnerLevel =
	| "L0" // 零基础
	| "L1" // 入门
	| "L2" // 进阶
	| "L3"; // 熟练

export type LessonLevel = 0 | 1 | 2 | 3; // Hook, L1, L2, L3

export interface Mission {
	why: string;
	successCriteria: string[];
	constraints: string[];
	outOfScope: string[];
}

export interface Analogy {
	concept: string;
	analogy: string;
	details: string;
	confidence: "low" | "medium" | "high";
}

export interface Source {
	name: string;
	url: string;
	confidence: 1 | 2 | 3 | 4 | 5;
	verificationMethod: string;
}

export interface LearningRecord {
	topic: string;
	level: LessonLevel;
	content: string;
	timestamp: Date;
	status: "active" | "superseded";
}

export interface TeachState {
	phase: TeachPhase;
	topic: string;
	mission?: Mission;
	learningStyle?: LearningStyle;
	learnerLevel: LearnerLevel;
	currentLevel: LessonLevel;
	glossary: Map<string, string>;
	sources: Source[];
	learningRecords: LearningRecord[];
	sessionId?: string;
}

export interface TeachResult {
	type: "question" | "lesson" | "complete" | "error" | "info";
	message: string;
	content?: string;
	level?: LessonLevel;
	options?: string[];
	nextAction?: "continue" | "ask" | "complete";
	state?: Partial<TeachState>;
}

export interface TeachLessonOptions {
	topic: string;
	level: LessonLevel;
	analogy: Analogy | null;
	sources: Source[];
	learnerLevel: LearnerLevel;
	learningStyle: LearningStyle;
}

export interface AnalogyEntry {
	concept: string;
	analogies: Analogy[];
}

export interface LearningPath {
	id: string;
	name: string;
	description: string;
	targetLevel: LearnerLevel;
	topics: LearningPathTopic[];
}

export interface LearningPathTopic {
	order: number;
	topic: string;
	duration: string;
	buildsOn: number[];
}
