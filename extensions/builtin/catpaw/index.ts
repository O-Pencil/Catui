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
	"`scripts/` and `agents/*.toml` in this bundle target the Claude Code / Cursor / Codex harness;",
	"Catui runs neither. If a referenced command needs to run, surface it to the user instead of",
	"running it via `bash`. Full detail: [CATUI.md](CATUI.md).",
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