/**
 * [WHO]: catpawExtension - bundles the "catpaw" UI/UX design craft skill as a Catui default-loaded extension
 * [FROM]: Depends on node:path, node:url, node:fs, core/extensions-host/types
 * [TO]: Auto-loaded by builtin-extensions.ts as a default extension; resource_loader scans the bundled SKILL.md via resources_discover
 * [HERE]: extensions/builtin/catpaw/index.ts - third-party skill bundle wrapper
 *
 * The skill content under ./SKILL.md and ./reference/, ./scripts/, ./agents/ was vendored from the upstream
 * "catpaw" skill package (installed via `npx catpaw install`). See THIRD_PARTY_NOTICE.md for
 * attribution, license, and known compatibility caveats.
 *
 * This wrapper does NOT translate hook scripts (scripts/hook*.mjs) or agent configs (agents/*.toml) into
 * Catui's extension API. Those files are vendored verbatim and remain inert under Catui - they target the
 * Claude Code / Cursor / Codex harness hook system, which Catui does not implement.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "../../../core/extensions-host/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = __dirname;

const BOOTSTRAP_PROMPT = [
	"## Catpaw (vendored UI/UX design skill)",
	"",
	"The `catpaw` skill is bundled as a Catui extension. Treat it as design-direction guidance when",
	"the user asks to design, redesign, critique, polish, audit, or otherwise improve a frontend",
	"interface. Load the SKILL.md via the `skill` tool when the task matches its description.",
	"",
	"Catui notes:",
	"- The skill body and `reference/*.md` are loaded normally through Catui's skill system.",
	"- Scripts under `scripts/` are Claude Code / Cursor / Codex harness scripts (hooks, live",
	"  iteration, browser screenshot capture). Catui does NOT execute them automatically. If a",
	"  referenced command needs to run, surface it to the user instead of running it via `bash`.",
	"- Agent configs under `agents/*.toml` describe Claude Code sub-agents and are not consumed by",
	"  Catui. They are kept here so the vendored bundle stays intact for cross-harness reuse.",
].join("\n");

export default async function catpawExtension(api: ExtensionAPI): Promise<void> {
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
		return { appendSystemPrompt: BOOTSTRAP_PROMPT };
	});
}