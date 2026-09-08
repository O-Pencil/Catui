/**
 * [WHO]: Private offline PawBench snapshot import and failure-diagnosis CLI
 * [FROM]: Depends on Node crypto/fs/path/util and optional evolution import/diagnosis validators
 * [TO]: Writes owner-only snapshots and advisory diagnosis reports for offline evolution workflows
 * [HERE]: scripts/evolution-pawbench.ts - non-networked file IO boundary for PawBench evolution evidence
 */

import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import {
	lstat,
	mkdir,
	open,
	rename,
	unlink,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs, TextDecoder } from "node:util";
import { diagnoseEvolutionBenchmarkFailures } from "../extensions/optional/evolution/benchmark-diagnosis.js";
import {
	importPawBenchEvolutionSnapshot,
	MAX_PAWBENCH_SOURCE_BYTES,
} from "../extensions/optional/evolution/pawbench-import.js";

export const PAWBENCH_CHECKPOINT_MAX_BYTES = MAX_PAWBENCH_SOURCE_BYTES;
const MANIFEST_MAX_BYTES = 16 * 1024 * 1024;
const SNAPSHOT_MAX_BYTES = 64 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

interface EvolutionPawBenchCliIo {
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	generatedAt?: string;
}

interface ImportCommand {
	command: "import";
	checkpointPath: string;
	manifestPath: string;
	outputPath: string;
}

interface DiagnoseCommand {
	command: "diagnose";
	snapshotPath: string;
	outputPath: string;
}

type EvolutionPawBenchCommand = ImportCommand | DiagnoseCommand;

class InputSizeLimitError extends Error {}

interface FileIdentity {
	dev: bigint;
	ino: bigint;
}

interface BoundedTextFile {
	absolutePath: string;
	identity: FileIdentity;
	text: string;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
	return error instanceof Error && "code" in error;
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
	return left.dev === right.dev && left.ino === right.ino;
}

function parseImportCommand(args: readonly string[]): ImportCommand {
	const parsed = parseArgs({
		args: [...args],
		allowPositionals: false,
		strict: true,
		tokens: true,
		options: {
			checkpoint: { type: "string" },
			manifest: { type: "string" },
			output: { type: "string" },
		},
	});
	const seenOptions = new Set<string>();
	for (const token of parsed.tokens) {
		if (token.kind !== "option") continue;
		if (seenOptions.has(token.name)) throw new Error("duplicate argument");
		seenOptions.add(token.name);
	}
	const checkpointPath = parsed.values.checkpoint?.trim();
	const manifestPath = parsed.values.manifest?.trim();
	const outputPath = parsed.values.output?.trim();
	if (!checkpointPath || !manifestPath || !outputPath) throw new Error("invalid arguments");
	return { command: "import", checkpointPath, manifestPath, outputPath };
}

function parseDiagnoseCommand(args: readonly string[]): DiagnoseCommand {
	const parsed = parseArgs({
		args: [...args],
		allowPositionals: false,
		strict: true,
		tokens: true,
		options: {
			snapshot: { type: "string" },
			output: { type: "string" },
		},
	});
	const seenOptions = new Set<string>();
	for (const token of parsed.tokens) {
		if (token.kind !== "option") continue;
		if (seenOptions.has(token.name)) throw new Error("duplicate argument");
		seenOptions.add(token.name);
	}
	const snapshotPath = parsed.values.snapshot?.trim();
	const outputPath = parsed.values.output?.trim();
	if (!snapshotPath || !outputPath) throw new Error("invalid arguments");
	return { command: "diagnose", snapshotPath, outputPath };
}

function parseCliArguments(args: readonly string[]): EvolutionPawBenchCommand {
	if (args[0] === "import") return parseImportCommand(args.slice(1));
	if (args[0] === "diagnose") return parseDiagnoseCommand(args.slice(1));
	throw new Error("invalid subcommand");
}

async function readBoundedText(path: string, maximumBytes: number): Promise<BoundedTextFile> {
	const absolutePath = resolve(path);
	const handle = await open(
		absolutePath,
		fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK,
	);
	try {
		const before = await handle.stat({ bigint: true });
		if (!before.isFile()) throw new Error("input must be a regular file");
		if (before.size > BigInt(maximumBytes)) throw new InputSizeLimitError();
		const chunks: Buffer[] = [];
		let totalBytes = 0;
		while (totalBytes <= maximumBytes) {
			const remaining = maximumBytes + 1 - totalBytes;
			const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining));
			const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
			if (bytesRead === 0) break;
			chunks.push(chunk.subarray(0, bytesRead));
			totalBytes += bytesRead;
		}
		const after = await handle.stat({ bigint: true });
		if (
			!after.isFile()
			|| after.dev !== before.dev
			|| after.ino !== before.ino
			|| after.size > BigInt(maximumBytes)
			|| totalBytes > maximumBytes
		) {
			throw new InputSizeLimitError();
		}
		return {
			absolutePath,
			identity: { dev: before.dev, ino: before.ino },
			text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
				.decode(Buffer.concat(chunks, totalBytes)),
		};
	} finally {
		await handle.close();
	}
}

async function assertSafeOutputDestination(
	absolutePath: string,
	inputs: readonly BoundedTextFile[],
): Promise<void> {
	if (inputs.some((input) => input.absolutePath === absolutePath)) {
		throw new Error("output cannot alias an input");
	}
	try {
		const destination = await lstat(absolutePath, { bigint: true });
		if (!destination.isFile()) throw new Error("output must be a regular file");
		const destinationIdentity = { dev: destination.dev, ino: destination.ino };
		if (inputs.some((input) => sameIdentity(input.identity, destinationIdentity))) {
			throw new Error("output cannot alias an input");
		}
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") return;
		throw error;
	}
}

async function writePrivateJson(
	path: string,
	value: unknown,
	inputs: readonly BoundedTextFile[],
): Promise<void> {
	const json = JSON.stringify(value, null, 2);
	if (typeof json !== "string") throw new Error("output is not serializable");
	const serialized = `${json}\n`;
	const absolutePath = resolve(path);
	await assertSafeOutputDestination(absolutePath, inputs);
	const parentPath = dirname(absolutePath);
	await mkdir(parentPath, { recursive: true });
	await assertSafeOutputDestination(absolutePath, inputs);
	const tempPath = join(
		parentPath,
		`.${basename(absolutePath)}.${randomBytes(16).toString("hex")}.tmp`,
	);
	let handle: FileHandle | undefined;
	let tempCreated = false;
	let renamed = false;
	try {
		handle = await open(tempPath, "wx", 0o600);
		tempCreated = true;
		const tempStat = await handle.stat({ bigint: true });
		const tempIdentity = { dev: tempStat.dev, ino: tempStat.ino };
		if (!tempStat.isFile() || inputs.some((input) => sameIdentity(input.identity, tempIdentity))) {
			throw new Error("temporary output is unsafe");
		}
		await handle.writeFile(serialized, { encoding: "utf8" });
		await handle.chmod(0o600);
		await handle.sync();
		await handle.close();
		handle = undefined;
		await assertSafeOutputDestination(absolutePath, inputs);
		await rename(tempPath, absolutePath);
		renamed = true;
	} finally {
		if (handle !== undefined) await handle.close().catch(() => undefined);
		if (tempCreated && !renamed) {
			try {
				await unlink(tempPath);
			} catch (error) {
				if (!isErrnoException(error) || error.code !== "ENOENT") throw error;
			}
		}
	}
}

export async function runEvolutionPawBenchCli(
	args: readonly string[],
	io: EvolutionPawBenchCliIo = {
		stdout: (line) => process.stdout.write(`${line}\n`),
		stderr: (line) => process.stderr.write(`${line}\n`),
	},
): Promise<number> {
	let options: EvolutionPawBenchCommand;
	try {
		options = parseCliArguments(args);
	} catch {
		io.stderr("Evolution PawBench error: invalid arguments");
		return 2;
	}

	if (options.command === "import") try {
		const checkpointFile = await readBoundedText(options.checkpointPath, PAWBENCH_CHECKPOINT_MAX_BYTES);
		const manifestFile = await readBoundedText(options.manifestPath, MANIFEST_MAX_BYTES);
		let manifest: unknown;
		try {
			manifest = JSON.parse(manifestFile.text) as unknown;
		} catch {
			throw new Error("invalid input");
		}
		const snapshot = importPawBenchEvolutionSnapshot(checkpointFile.text, manifest);
		await writePrivateJson(options.outputPath, snapshot, [checkpointFile, manifestFile]);
		io.stdout(`IMPORTED ${snapshot.role} ${snapshot.runs.length}`);
		return 0;
	} catch (error) {
		io.stderr(error instanceof InputSizeLimitError
			? "Evolution PawBench error: input exceeds size limit"
			: "Evolution PawBench error: import failed");
		return 2;
	}

	try {
		const snapshotFile = await readBoundedText(options.snapshotPath, SNAPSHOT_MAX_BYTES);
		let snapshot: unknown;
		try {
			snapshot = JSON.parse(snapshotFile.text) as unknown;
		} catch {
			throw new Error("invalid input");
		}
		const report = diagnoseEvolutionBenchmarkFailures(snapshot, {
			generatedAt: io.generatedAt ?? new Date().toISOString(),
		});
		await writePrivateJson(options.outputPath, report, [snapshotFile]);
		io.stdout(`DIAGNOSED ${report.cohorts.length}`);
		return 0;
	} catch (error) {
		io.stderr(error instanceof InputSizeLimitError
			? "Evolution PawBench error: input exceeds size limit"
			: "Evolution PawBench error: diagnosis failed");
		return 2;
	}
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === entryPath) {
	process.exitCode = await runEvolutionPawBenchCli(process.argv.slice(2));
}
