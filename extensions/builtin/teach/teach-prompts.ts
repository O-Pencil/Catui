/**
 * [WHO]: teachPrompts - teaching prompt templates
 * [FROM]: Depends on teach-types.ts for type definitions, teach-i18n.ts for localized strings
 * [TO]: Consumed by teach-runtime.ts
 * [HERE]: extensions/builtin/teach/teach-prompts.ts - prompt generation for teach extension
 */

import type { Analogy, LearningStyle, LearnerLevel, LessonLevel, Source, TeachLessonOptions } from "./teach-types.js";
import { teachText, type TeachLocale } from "./teach-i18n.js";

/**
 * Generate mission discovery prompt
 */
export function missionDiscoveryPrompt(topic: string, locale: TeachLocale = "en"): string {
	const t = teachText(locale);

	return [
		`### ${t.missionDiscoveryTitle}`,
		"",
		`Before we start learning **${topic}**, I need to understand:`,
		"",
		`1. **${t.missionWhyQuestion}**`,
		"   - Are you trying to solve a specific problem?",
		"   - Or is it pure curiosity?",
		"",
		`2. **${t.missionSuccessQuestion}**`,
		"   - What will you be able to do after learning this?",
		"   - How will you know you've succeeded?",
		"",
		`3. **${t.missionConstraintsQuestion}**`,
		"   - How much time do you have?",
		"   - Any specific requirements?",
		"",
		`4. **${t.missionOutOfScopeQuestion}**`,
		"   - What should we NOT cover right now?",
		"",
		"Please share your thoughts so I can customize the learning experience for you.",
	].join("\n");
}

/**
 * Generate learning style selection prompt
 */
export function learningStylePrompt(locale: TeachLocale = "en"): string {
	const t = teachText(locale);

	return [
		`### ${t.learningStyleTitle}`,
		"",
		"Choose your preferred learning style:",
		"",
		"| Style | Duration | Depth | Best For |",
		"|-------|----------|-------|----------|",
		`| **Quick Overview** | 10-15 min | Essentials | "Just need to know enough" |`,
		`| **Deep Dive** | 30-60 min | Comprehensive | "Want to truly understand" |`,
		`| **Focused Skill** | 20-30 min | Single skill | "Master one specific thing" |`,
		`| **Holistic** | Multiple sessions | Full picture | "Become an expert" |`,
		"",
		"Which style works best for you?",
	].join("\n");
}

/**
 * Generate hook (Level 0)
 */
export function hookPrompt(options: TeachLessonOptions, locale: TeachLocale = "en"): string {
	const t = teachText(locale);
	const { topic, analogy, sources } = options;

	const lines: string[] = [
		`### 🎣 ${t.levelHook}「${topic}」？`,
		"",
	];

	// Add a relatable scenario
	lines.push(generateHookScenario(topic));
	lines.push("");

	// Add analogy if available
	if (analogy) {
		lines.push("**Analogy**: " + analogy.analogy);
		if (analogy.details) {
			lines.push("");
			lines.push(analogy.details);
		}
		lines.push("");
	}

	// Add source verification
	if (sources.length > 0) {
		lines.push("---");
		lines.push("");
		lines.push("**Source Verification**:");
		for (const source of sources) {
			lines.push(`- [${source.name}](${source.url}) - ${t.confidenceLabel}: ${"⭐".repeat(source.confidence)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Generate Level 1 (One-sentence version)
 */
export function level1Prompt(options: TeachLessonOptions, locale: TeachLocale = "en"): string {
	const t = teachText(locale);
	const { topic, analogy, sources } = options;

	const lines: string[] = [
		`### 📍 ${t.level1}`,
		"",
		`**${topic}** is ${generateOneLiner(topic)}.`,
		"",
	];

	if (analogy) {
		lines.push(`Think of it like: ${analogy.analogy}`);
		lines.push("");
	}

	lines.push("That's the basics. Let's see how it actually works.");
	lines.push("");

	// Add source verification
	if (sources.length > 0) {
		lines.push("---");
		lines.push("");
		lines.push(`**${t.sourceLabel}**:`);
		for (const source of sources) {
			lines.push(`- [${source.name}](${source.url}) - ${t.confidenceLabel}: ${"⭐".repeat(source.confidence)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Generate Level 2 (Working knowledge)
 */
export function level2Prompt(options: TeachLessonOptions, locale: TeachLocale = "en"): string {
	const t = teachText(locale);
	const { topic, sources, learnerLevel } = options;

	const lines: string[] = [
		`### 🔍 ${t.level2}`,
		"",
	];

	// Core concepts
	lines.push("**Core Concepts**:");
	lines.push("");
	lines.push(`- **${topic}** has several key components`);
	lines.push("  - Each serves a specific purpose");
	lines.push("  - They work together to achieve the goal");
	lines.push("");

	// Example based on learner level
	lines.push("**Example**:");
	lines.push("");
	lines.push("```");
	lines.push(`// ${generateExample(topic, learnerLevel)}`);
	lines.push("```");
	lines.push("");

	// Visual diagram
	lines.push("**How it works**:");
	lines.push("");
	lines.push("```mermaid");
	lines.push(generateMermaidDiagram(topic));
	lines.push("```");
	lines.push("");

	// Comparison table
	lines.push("**Comparison**:");
	lines.push("");
	lines.push("| What you already know | What's new |");
	lines.push("|----------------------|------------|");
	lines.push(`| ${generateComparison(topic).existing} | ${generateComparison(topic).new} |`);
	lines.push("");

	// Add source verification
	if (sources.length > 0) {
		lines.push("---");
		lines.push("");
		lines.push(`**${t.sourceLabel}**:`);
		for (const source of sources) {
			lines.push(`- [${source.name}](${source.url}) - ${t.confidenceLabel}: ${"⭐".repeat(source.confidence)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Generate Level 3 (Deep dive)
 */
export function level3Prompt(options: TeachLessonOptions, locale: TeachLocale = "en"): string {
	const t = teachText(locale);
	const { topic, sources } = options;

	const lines: string[] = [
		`### 🐇 ${t.level3}`,
		"",
		"In real-world applications, this gets more complex:",
		"",
	];

	// Complications
	lines.push("**Advanced considerations**:");
	lines.push("");
	lines.push(`1. **Edge cases**: ${topic} has several edge cases you'll encounter`);
	lines.push("   - These are common in production environments");
	lines.push("   - Understanding them prevents bugs");
	lines.push("");
	lines.push(`2. **Performance**: ${topic} can impact performance`);
	lines.push("   - Know when to optimize");
	lines.push("   - Measure before optimizing");
	lines.push("");
	lines.push(`3. **Best practices**: Follow established patterns`);
	lines.push("   - They exist for a reason");
	lines.push("   - Learn from others' mistakes");
	lines.push("");

	// Real-world example
	lines.push("**Real-world example**:");
	lines.push("");
	lines.push("```");
	lines.push(`// ${generateRealWorldExample(topic)}`);
	lines.push("```");
	lines.push("");

	// When you'll encounter this
	lines.push("**When you'll encounter this**:");
	lines.push("");
	lines.push("- When scaling your application");
	lines.push("- When debugging production issues");
	lines.push("- When reviewing code with experienced developers");
	lines.push("");

	// Add source verification
	if (sources.length > 0) {
		lines.push("---");
		lines.push("");
		lines.push(`**${t.sourceLabel}**:`);
		for (const source of sources) {
			lines.push(`- [${source.name}](${source.url}) - ${t.confidenceLabel}: ${"⭐".repeat(source.confidence)}`);
		}
	}

	return lines.join("\n");
}

/**
 * Generate bridge (relevance to learner)
 */
export function bridgePrompt(topic: string, locale: TeachLocale = "en"): string {
	const lines: string[] = [
		"### 🌉 Why this matters to you",
		"",
		`Understanding **${topic}** helps you:`,
		"",
		`1. **Make better decisions**: You'll know what's possible and what's not`,
		`2. **Communicate effectively**: You can discuss ${topic} with others`,
		`3. **Solve problems faster**: You'll recognize patterns and solutions`,
		"",
		"**Useful phrases**:",
		`- "How does our ${topic} work?"`,
		`- "What are the trade-offs for this ${topic} approach?"`,
	];

	return lines.join("\n");
}

/**
 * Generate takeaways
 */
export function takeawaysPrompt(topic: string, locale: TeachLocale = "en"): string {
	const lines: string[] = [
		"### ✨ Remember these three things",
		"",
		`1. **Core concept**: ${topic} is fundamental to understanding the bigger picture`,
		`2. **Practical value**: It helps you make informed decisions`,
		`3. **Growth opportunity**: Mastering ${topic} opens doors to advanced topics`,
		"",
		"---",
		"",
		"**Want to explore more?**",
		`- Try applying what you learned in a real scenario`,
		`- Ask questions about specific aspects you're curious about`,
		`- Practice with hands-on exercises`,
	];

	return lines.join("\n");
}

/**
 * Generate Feynman check prompt
 */
export function feynmanCheckPrompt(locale: TeachLocale = "en"): string {
	const t = teachText(locale);
	return `\n\n---\n\n**${t.checkpointFeynman}**\n\nThis helps solidify your understanding and identifies any gaps.`;
}

/**
 * Generate checkpoint prompt
 */
export function checkpointPrompt(type: "continue" | "digest" | "depth", locale: TeachLocale = "en"): string {
	const t = teachText(locale);

	switch (type) {
		case "continue":
			return `\n\n---\n\n${t.checkpointContinue}`;
		case "digest":
			return `\n\n---\n\n${t.checkpointDigest}`;
		case "depth":
			return `\n\n---\n\n${t.checkpointMoreDepth}`;
	}
}

/**
 * Generate completion message
 */
export function completionPrompt(topic: string, locale: TeachLocale = "en"): string {
	const t = teachText(locale);

	return [
		`### ${t.completionTitle}`,
		"",
		`${t.completionMessage} **${topic}**!`,
		"",
		`${t.completionNextSteps}`,
		"",
		"- Practice with real examples",
		"- Explore related topics",
		"- Ask follow-up questions",
	].join("\n");
}

// Helper functions

function generateHookScenario(topic: string): string {
	const scenarios = [
		`Have you ever wondered how ${topic} works in practice?`,
		`You've probably encountered ${topic} without realizing it.`,
		`Understanding ${topic} will change how you think about this area.`,
		`Many people struggle with ${topic} at first, but it's actually quite logical.`,
	];
	return scenarios[Math.floor(Math.random() * scenarios.length)];
}

function generateOneLiner(topic: string): string {
	return `a fundamental concept that helps you understand and work with ${topic} effectively`;
}

function generateExample(topic: string, level: LearnerLevel): string {
	if (level === "L0" || level === "L1") {
		return `// Simple example of ${topic}
// This shows the basic idea in action`;
	}
	return `// Example of ${topic} in practice
// This demonstrates how it's used in real applications`;
}

function generateMermaidDiagram(topic: string): string {
	return `graph TD
    A[Start] --> B[Understand ${topic}]
    B --> C[Apply Knowledge]
    C --> D[Get Results]
    D --> E[Learn More]`;
}

function generateComparison(topic: string): { existing: string; new: string } {
	return {
		existing: "Something you already understand",
		new: `How ${topic} extends this concept`,
	};
}

function generateRealWorldExample(topic: string): string {
	return `// Real-world usage of ${topic}
// This is how it's used in production code`;
}
