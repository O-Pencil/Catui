/**
 * [WHO]: Repair scope constraints and independent reviewer schema
 * [FROM]: Local source job contracts
 * [TO]: Worker and verifier; generated patches cannot change this authority
 * [HERE]: extensions/optional/evolution/source/delivery/policy.ts - acceptance boundary
 */
export function repairable(path: string): boolean {
	if (path.includes("..") || path.startsWith("/") || path.includes("\\")) return false;
	if (/^(?:\.git|\.catui|node_modules|dist|scripts|test|tests|packages|\.github|\.githooks)(?:\/|$)/.test(path)) return false;
	if (/(?:^|\/)(?:package(?:-lock)?\.json|AGENTS\.md|tsconfig[^/]*|[^/]*\.test\.ts)$/.test(path)) return false;
	if (path.startsWith("extensions/optional/evolution/source/")) return false;
	if (path === "docs/pencil-platform-charter.md") return false;
	if (path.startsWith("core/session/") || path.startsWith("core/platform/config/") || path === "migrations.ts") return false;
	return /^(?:core\/|modes\/|extensions\/|cli\/|docs\/|\.dev-docs\/)|^[\w-]+\.ts$/.test(path);
}
export interface ReviewVerdict { approved: boolean; reproducesRealDefect: boolean; preservesBehavior: boolean; publishable: boolean; reason: string }
export function parseObject(text: string): Record<string, unknown> {
	const stripped = text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
	const value = JSON.parse(stripped);
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Worker must return a JSON object");
	return value;
}
export function acceptedReview(text: string): ReviewVerdict {
	const v = parseObject(text);
	if (v.approved !== true || v.reproducesRealDefect !== true || v.preservesBehavior !== true || v.publishable !== true || typeof v.reason !== "string") throw new Error("Independent review rejected candidate");
	return v as unknown as ReviewVerdict;
}
