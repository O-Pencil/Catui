/**
 * [WHO]: TeachPersistence - learning record and mission persistence
 * [FROM]: Depends on node:fs, node:path for file operations
 * [TO]: Consumed by teach-runtime.ts
 * [HERE]: extensions/builtin/teach/teach-persistence.ts - data persistence for teach extension
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { LearningRecord, Mission } from "./teach-types.js";

const TEACH_DIR = ".nanopencil/teach";
const RECORDS_DIR = "records";
const MISSIONS_DIR = "missions";
const GLOSSARY_FILE = "glossary.json";

export class TeachPersistence {
	private basePath: string;

	constructor(workspacePath: string) {
		this.basePath = join(workspacePath, TEACH_DIR);
	}

	private ensureDirectories(): void {
		if (!existsSync(this.basePath)) {
			mkdirSync(this.basePath, { recursive: true });
		}
		const recordsPath = join(this.basePath, RECORDS_DIR);
		if (!existsSync(recordsPath)) {
			mkdirSync(recordsPath, { recursive: true });
		}
		const missionsPath = join(this.basePath, MISSIONS_DIR);
		if (!existsSync(missionsPath)) {
			mkdirSync(missionsPath, { recursive: true });
		}
	}

	/**
	 * Save a learning record
	 */
	async saveLearningRecord(record: LearningRecord): Promise<string> {
		this.ensureDirectories();

		const recordsPath = join(this.basePath, RECORDS_DIR);
		const timestamp = record.timestamp.toISOString().replace(/[:.]/g, "-");
		const topicSlug = record.topic
			.toLowerCase()
			.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
			.replace(/^-|-$/g, "");
		const filename = `${timestamp}-${topicSlug}.md`;
		const filepath = join(recordsPath, filename);

		const content = `# ${record.topic}

${record.content}

---

## Metadata

- **Level**: ${record.level}
- **Status**: ${record.status}
- **Timestamp**: ${record.timestamp.toISOString()}
`;

		writeFileSync(filepath, content, "utf-8");
		return filepath;
	}

	/**
	 * Load learning records for a topic
	 */
	async loadLearningRecords(topic: string): Promise<LearningRecord[]> {
		this.ensureDirectories();

		const recordsPath = join(this.basePath, RECORDS_DIR);
		if (!existsSync(recordsPath)) {
			return [];
		}

		const files = readdirSync(recordsPath).filter((f) => f.endsWith(".md"));
		const records: LearningRecord[] = [];

		for (const file of files) {
			try {
				const filepath = join(recordsPath, file);
				const content = readFileSync(filepath, "utf-8");

				// Extract metadata from markdown
				const topicMatch = content.match(/^# (.+)$/m);
				const levelMatch = content.match(/\*\*Level\*\*:\s*(\d)/);
				const statusMatch = content.match(/\*\*Status\*\*:\s*(active|superseded)/);
				const timestampMatch = content.match(/\*\*Timestamp\*\*:\s*(.+)$/m);

				if (topicMatch) {
					const recordTopic = topicMatch[1].trim();
					// Check if this record is related to the requested topic
					if (
						recordTopic.toLowerCase().includes(topic.toLowerCase()) ||
						topic.toLowerCase().includes(recordTopic.toLowerCase())
					) {
						records.push({
							topic: recordTopic,
							level: (levelMatch ? Number.parseInt(levelMatch[1], 10) : 0) as LearningRecord["level"],
							content: content.split("---")[0].trim(),
							timestamp: timestampMatch ? new Date(timestampMatch[1]) : new Date(),
							status: (statusMatch?.[1] as "active" | "superseded") ?? "active",
						});
					}
				}
			} catch {
				// Skip files that can't be parsed
			}
		}

		return records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
	}

	/**
	 * Save a mission
	 */
	async saveMission(topic: string, mission: Mission): Promise<string> {
		this.ensureDirectories();

		const missionsPath = join(this.basePath, MISSIONS_DIR);
		const topicSlug = topic
			.toLowerCase()
			.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
			.replace(/^-|-$/g, "");
		const filename = `${topicSlug}.md`;
		const filepath = join(missionsPath, filename);

		const content = `# Mission: ${topic}

## Why
${mission.why}

## Success looks like
${mission.successCriteria.map((s) => `- ${s}`).join("\n")}

## Constraints
${mission.constraints.length > 0 ? mission.constraints.map((c) => `- ${c}`).join("\n") : "- None specified"}

## Out of scope
${mission.outOfScope.length > 0 ? mission.outOfScope.map((o) => `- ${o}`).join("\n") : "- None specified"}

---

*Created: ${new Date().toISOString()}*
`;

		writeFileSync(filepath, content, "utf-8");
		return filepath;
	}

	/**
	 * Load a mission for a topic
	 */
	async loadMission(topic: string): Promise<Mission | null> {
		this.ensureDirectories();

		const missionsPath = join(this.basePath, MISSIONS_DIR);
		const topicSlug = topic
			.toLowerCase()
			.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
			.replace(/^-|-$/g, "");
		const filepath = join(missionsPath, `${topicSlug}.md`);

		if (!existsSync(filepath)) {
			return null;
		}

		try {
			const content = readFileSync(filepath, "utf-8");

			const whyMatch = content.match(/## Why\n([\s\S]*?)(?=\n## )/);
			const successMatch = content.match(/## Success looks like\n([\s\S]*?)(?=\n## )/);
			const constraintsMatch = content.match(/## Constraints\n([\s\S]*?)(?=\n## )/);
			const outOfScopeMatch = content.match(/## Out of scope\n([\s\S]*?)(?=\n---)/);

			return {
				why: whyMatch?.[1]?.trim() ?? "",
				successCriteria: successMatch?.[1]
					?.split("\n")
					.filter((line) => line.startsWith("- "))
					.map((line) => line.slice(2).trim()) ?? [],
				constraints: constraintsMatch?.[1]
					?.split("\n")
					.filter((line) => line.startsWith("- "))
					.map((line) => line.slice(2).trim())
					.filter((c) => c !== "None specified") ?? [],
				outOfScope: outOfScopeMatch?.[1]
					?.split("\n")
					.filter((line) => line.startsWith("- "))
					.map((line) => line.slice(2).trim())
					.filter((o) => o !== "None specified") ?? [],
			};
		} catch {
			return null;
		}
	}

	/**
	 * Save glossary
	 */
	async saveGlossary(glossary: Map<string, string>): Promise<void> {
		this.ensureDirectories();

		const filepath = join(this.basePath, GLOSSARY_FILE);
		const glossaryObj = Object.fromEntries(glossary);
		writeFileSync(filepath, JSON.stringify(glossaryObj, null, 2), "utf-8");
	}

	/**
	 * Load glossary
	 */
	async loadGlossary(): Promise<Map<string, string>> {
		this.ensureDirectories();

		const filepath = join(this.basePath, GLOSSARY_FILE);
		if (!existsSync(filepath)) {
			return new Map();
		}

		try {
			const content = readFileSync(filepath, "utf-8");
			const glossaryObj = JSON.parse(content) as Record<string, string>;
			return new Map(Object.entries(glossaryObj));
		} catch {
			return new Map();
		}
	}
}
