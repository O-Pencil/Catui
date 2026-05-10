/**
 * [WHO]: writeRawRecovery() for TokenSave raw output recovery files
 * [FROM]: Depends on node:fs/promises, node:path, node:crypto
 * [TO]: Consumed by extensions/defaults/token-save/runner.ts
 * [HERE]: extensions/defaults/token-save/recovery.ts - raw tee/recovery persistence
 */
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function writeRawRecovery(projectPath: string, raw: string): Promise<string | undefined> {
	try {
		const dir = join(projectPath, ".nanopencil", "token-save", "raw");
		await mkdir(dir, { recursive: true });
		const path = join(dir, `${Date.now()}-${randomBytes(4).toString("hex")}.log`);
		await writeFile(path, raw, "utf8");
		return path;
	} catch {
		return undefined;
	}
}
