/**
 * [WHO]: humanizerExtension - bundles the "humanizer" writing-quality skill as a Catui default-loaded extension
 * [FROM]: Depends on node:fs, node:path, node:url, core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension; resource_loader scans the bundled SKILL.md via resources_discover
 * [HERE]: extensions/builtin/humanizer/index.ts - third-party skill bundle wrapper
 *
 * The skill content under ./SKILL.md was vendored from the upstream "humanizer" Agent Skill
 * (github.com/blader/humanizer, v3.0.0, MIT). See THIRD_PARTY_NOTICE.md for attribution and license.
 *
 * The skill removes AI-writing tells from prose (not-X-but-Y contrasts, one-line closers, forced
 * triads, AI-word habits, chat residue) without changing meaning and without inventing facts.
 * It is a writing-quality skill grounded in Wikipedia's public "Signs of AI writing" guide —
 * it is NOT about evading AI-content detectors.
 *
 * This wrapper registers the skill via resources_discover only (on-demand loading through the
 * `skill` tool), so the 8KB skill body never enters the default system prompt. The bootstrap
 * note stays short because every catalogued skill's name and description already reach the
 * default prompt through the skill catalog; this note only states the routing boundary.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = __dirname;

export const HUMANIZER_BOOTSTRAP_PROMPT = [
	"## Humanizer (vendored writing-quality skill)",
	"",
	"Use `humanizer` when editing or reviewing user-facing prose, not code. It removes AI-writing tells",
	"without changing meaning and never invents facts or sources. Load SKILL.md via the `skill` tool.",
].join("\n");

export default async function humanizerExtension(api: ExtensionAPI): Promise<void> {
	api.on("resources_discover", () => {
		if (!existsSync(SKILL_DIR)) {
			return;
		}
		const skillFile = join(SKILL_DIR, "SKILL.md");
		if (!existsSync(skillFile)) {
			return;
		}
		return { skillPaths: [skillFile] };
	});

	api.on("before_agent_start", () => {
		if (!existsSync(SKILL_DIR)) {
			return;
		}
		return { appendSystemPrompt: HUMANIZER_BOOTSTRAP_PROMPT };
	});
}