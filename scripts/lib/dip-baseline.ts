/**
 * [WHO]: Provides loadBaseline(), saveBaseline(), partitionByBaseline() and
 *        BASELINE_PATH — the single ratchet shared by verify-dip and
 *        verify-structure.
 * [FROM]: Depends on node:fs, node:path only. No repository knowledge.
 * [TO]: Consumed by scripts/verify-dip.ts, scripts/verify-structure.ts
 * [HERE]: scripts/lib/dip-baseline.ts - shared gate debt ledger; two gates, one
 *         ratchet, so a violation cannot pass one and fail the other.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BASELINE_PATH = join(REPO_ROOT, ".dev-docs", "structure-baseline.json");

/** A gate violation reduced to the only field the ratchet cares about. */
export interface Ratchetable {
	/** Stable machine key, e.g. "P3-MISSING-HEADER:core/tools/read.ts".
	 *  Prose messages may be reworded freely; keys may not. */
	key: string;
}

export interface BaselineFile {
	note: string;
	keys: string[];
}

const NOTE = [
	"Known structural debt, recorded when the ratchet was introduced.",
	"",
	"Both gates FAIL on any violation whose key is absent from this list, and both",
	"refuse to rewrite this file with new entries unless --allow-grow is passed.",
	"The baseline is therefore a one-way ratchet: it may shrink, never grow.",
	"",
	"To shrink it, fix the entry — add the missing P3 header, add the missing",
	"AGENT.md, or split the file. Once the underlying violation stops being",
	"reported, its key stops matching and the entry becomes dead weight.",
	"",
	"Regenerate with: npm run verify:baseline:update",
].join("\n");

export function loadBaseline(): { keys: Set<string>; exists: boolean } {
	try {
		const parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf-8")) as BaselineFile;
		return { keys: new Set(Array.isArray(parsed.keys) ? parsed.keys : []), exists: true };
	} catch {
		return { keys: new Set(), exists: false };
	}
}

/** Persist the current violation set as the new debt level.
 *
 *  The ledger is shared by several gates, and each gate can only observe its
 *  own violations. `ownedPrefixes` names the key namespaces this call site is
 *  authoritative for; keys outside that set are carried over untouched. Without
 *  this, `verify-dip --update-baseline` would silently erase every
 *  SIZE-OVER-LIMIT entry and the next verify-structure run would fail on debt
 *  that had not changed.
 *
 *  The first write is a bootstrap and always succeeds: a repo that has never
 *  had a ratchet cannot adopt one without recording what it already owes.
 *  Because the bootstrap path ignores --allow-grow, deleting this file is not
 *  a way to reset the ratchet to zero and regrow it freely — it only ever
 *  re-records the debt that exists right now.
 *
 *  Returns the total number of keys in the ledger after the write. Exits the
 *  process on refused growth. */
export function saveBaseline(
	keys: string[],
	ownedPrefixes: readonly string[],
	allowGrow: boolean,
): number {
	const { keys: previousKeys, exists } = loadBaseline();
	const mine = [...new Set(keys)].sort();
	const foreign = [...previousKeys].filter(k => !ownedPrefixes.some(p => k.startsWith(p))).sort();
	const incoming = [...new Set([...mine, ...foreign])].sort();

	const payload: BaselineFile = { note: NOTE, keys: incoming };

	if (!exists) {
		write(payload);
		return incoming.length;
	}

	const added = mine.filter(k => !previousKeys.has(k));
	if (added.length > 0 && !allowGrow) {
		console.error(
			`\n⛔ Refusing to grow the structural baseline by ${added.length} ` +
				`entr${added.length === 1 ? "y" : "ies"}.\n` +
				`   The ratchet only moves down. Fix the new violations, or pass\n` +
				`   --allow-grow together with a written justification in .dev-docs.\n` +
				`   New entries:\n` +
				added.slice(0, 20).map(k => `     - ${k}`).join("\n") +
				(added.length > 20 ? `\n     ... and ${added.length - 20} more` : ""),
		);
		process.exit(1);
	}

	write(payload);
	return incoming.length;
}

function write(payload: BaselineFile): void {
	mkdirSync(dirname(BASELINE_PATH), { recursive: true });
	writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf-8");
}

/** Split violations into the ones the baseline already accepts and the ones
 *  that constitute a regression. Only the latter may fail a build. */
export function partitionByBaseline<T extends Ratchetable>(
	violations: T[],
): { known: T[]; fresh: T[] } {
	const { keys } = loadBaseline();
	const known: T[] = [];
	const fresh: T[] = [];
	for (const v of violations) (keys.has(v.key) ? known : fresh).push(v);
	return { known, fresh };
}

export function baselineExists(): boolean {
	return existsSync(BASELINE_PATH);
}
