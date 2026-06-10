/**
 * [WHO]: teachI18n - internationalization for teach extension
 * [FROM]: Depends on core/platform/i18n for locale detection
 * [TO]: Consumed by teach-runtime.ts, teach-prompts.ts, teach-format.ts
 * [HERE]: extensions/builtin/teach/teach-i18n.ts - i18n strings for teach extension
 */

export type TeachLocale = "en" | "zh";

interface TeachStrings {
	// Commands
	commandDescription: string;
	commandArgTopic: string;

	// Mission Discovery
	missionDiscoveryTitle: string;
	missionWhyQuestion: string;
	missionSuccessQuestion: string;
	missionConstraintsQuestion: string;
	missionOutOfScopeQuestion: string;

	// Learning Style
	learningStyleTitle: string;
	learningStyleQuick: string;
	learningStyleDeep: string;
	learningStyleFocused: string;
	learningStyleHolistic: string;

	// Teaching Levels
	levelHook: string;
	level1: string;
	level2: string;
	level3: string;

	// Source Verification
	sourceLabel: string;
	confidenceLabel: string;
	verificationMethodLabel: string;
	sourceUnavailable: string;
	sourceUnverified: string;

	// Progress Tracking
	progressSaved: string;
	progressLoaded: string;
	learningRecordSaved: string;

	// Checkpoints
	checkpointContinue: string;
	checkpointDigest: string;
	checkpointMoreDepth: string;
	checkpointFeynman: string;

	// Errors
	errorNoTopic: string;
	errorInvalidStyle: string;
	errorSourceVerificationFailed: string;

	// Completion
	completionTitle: string;
	completionMessage: string;
	completionNextSteps: string;
}

const en: TeachStrings = {
	// Commands
	commandDescription: "Learn something new with guided, source-verified teaching",
	commandArgTopic: "What do you want to learn?",

	// Mission Discovery
	missionDiscoveryTitle: "🎯 Mission Discovery",
	missionWhyQuestion: "Why do you want to learn this?",
	missionSuccessQuestion: "What does success look like?",
	missionConstraintsQuestion: "Any constraints? (time, resources, etc.)",
	missionOutOfScopeQuestion: "What's out of scope for now?",

	// Learning Style
	learningStyleTitle: "📚 Learning Style",
	learningStyleQuick: "Quick Overview (10-15 min) - Just the essentials",
	learningStyleDeep: "Deep Dive (30-60 min) - Comprehensive understanding",
	learningStyleFocused: "Focused Skill (20-30 min) - Master one specific thing",
	learningStyleHolistic: "Holistic (multiple sessions) - Become an expert",

	// Teaching Levels
	levelHook: "🎣 Why should you learn about",
	level1: "📍 One-sentence version",
	level2: "🔍 How it works",
	level3: "🐇 Deep dive (optional)",

	// Source Verification
	sourceLabel: "Source",
	confidenceLabel: "Confidence",
	verificationMethodLabel: "Verification method",
	sourceUnavailable: "No reliable source available",
	sourceUnverified: "Unverified - needs confirmation",

	// Progress Tracking
	progressSaved: "Progress saved",
	progressLoaded: "Previous progress loaded",
	learningRecordSaved: "Learning record saved",

	// Checkpoints
	checkpointContinue: "Ready to continue?",
	checkpointDigest: "Would you like to continue or digest what you've learned?",
	checkpointMoreDepth: "Want to go deeper?",
	checkpointFeynman: "Can you describe this in your own words?",

	// Errors
	errorNoTopic: "Please specify a topic. Usage: /teach <topic>",
	errorInvalidStyle: "Invalid learning style selected",
	errorSourceVerificationFailed: "Failed to verify source",

	// Completion
	completionTitle: "✨ Learning Complete",
	completionMessage: "You've completed the lesson on",
	completionNextSteps: "Want to explore more?",
};

const zh: TeachStrings = {
	// Commands
	commandDescription: "通过引导式、来源验证的教学学习新知识",
	commandArgTopic: "你想学什么？",

	// Mission Discovery
	missionDiscoveryTitle: "🎯 任务发现",
	missionWhyQuestion: "你为什么想学这个？",
	missionSuccessQuestion: "成功的标准是什么？",
	missionConstraintsQuestion: "有什么限制吗？（时间、资源等）",
	missionOutOfScopeQuestion: "暂时不包括哪些内容？",

	// Learning Style
	learningStyleTitle: "📚 学习风格",
	learningStyleQuick: "快速概览 (10-15 分钟) - 只讲核心",
	learningStyleDeep: "深入学习 (30-60 分钟) - 全面理解",
	learningStyleFocused: "单点突破 (20-30 分钟) - 专注一个技能",
	learningStyleHolistic: "系统学习 (多轮对话) - 成为专家",

	// Teaching Levels
	levelHook: "🎣 为什么你应该了解",
	level1: "📍 一句话版本",
	level2: "🔍 它是怎么工作的",
	level3: "🐇 深入了解（可选）",

	// Source Verification
	sourceLabel: "来源",
	confidenceLabel: "置信度",
	verificationMethodLabel: "验证方法",
	sourceUnavailable: "暂无可靠来源",
	sourceUnverified: "待验证 - 需要确认",

	// Progress Tracking
	progressSaved: "进度已保存",
	progressLoaded: "已加载之前的进度",
	learningRecordSaved: "学习记录已保存",

	// Checkpoints
	checkpointContinue: "准备继续吗？",
	checkpointDigest: "想继续深入还是先消化一下？",
	checkpointMoreDepth: "还想继续深入吗？",
	checkpointFeynman: "你能用自己的话描述一下吗？",

	// Errors
	errorNoTopic: "请指定学习主题。用法：/teach <主题>",
	errorInvalidStyle: "选择的学习风格无效",
	errorSourceVerificationFailed: "来源验证失败",

	// Completion
	completionTitle: "✨ 学习完成",
	completionMessage: "你已经完成了关于",
	completionNextSteps: "想继续探索吗？",
};

const strings: Record<TeachLocale, TeachStrings> = {
	en,
	zh,
};

export function getTeachLocale(locale?: string): TeachLocale {
	if (locale === "zh" || locale === "zh-CN" || locale === "zh-TW") {
		return "zh";
	}
	return "en";
}

export function teachText(locale?: TeachLocale): TeachStrings {
	return strings[locale ?? "en"];
}

export function detectTeachLocale(): TeachLocale {
	// Default to English, can be overridden by user settings
	return "en";
}
