/**
 * [WHO]: Pure task classification and explicit correction detection
 * [FROM]: No dependencies
 * [TO]: Foreground observation bridge
 * [HERE]: extensions/optional/evolution/source/learning/detectors.ts - adaptive detection method
 */
export function taskCohort(prompt: string): { taskCategory: string; inputBucket: string } {
	const categories: [string, RegExp][] = [["repair", /fix|bug|error|修复|报错/i], ["refactor", /refactor|重构/i], ["test", /test|测试/i], ["research", /research|investigate|调研|研究/i], ["implementation", /implement|build|create|实现|新增/i]];
	return { taskCategory: categories.find(([, pattern]) => pattern.test(prompt))?.[0] ?? "general", inputBucket: prompt.length < 200 ? "short" : prompt.length < 1000 ? "medium" : "long" };
}
export function isCorrection(prompt: string): boolean { return /still (?:wrong|broken|fail)|not (?:fixed|working)|仍然|还是不|没有修好|不对/i.test(prompt); }
