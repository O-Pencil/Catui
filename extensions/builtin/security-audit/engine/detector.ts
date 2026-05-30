/**
 * [WHO]: DangerDetector
 * [FROM]: Depends on node:os, node:path, ../interface.js
 * [TO]: Consumed by extension entry point (./index.ts)
 * [HERE]: extensions/builtin/security-audit/engine/detector.ts -
 */


import { homedir } from "node:os";
import { resolve } from "node:path";
import type { SecurityCheckResult, SecurityLevel, SecurityConfig } from "../interface.js";
import { DEFAULT_SECURITY_CONFIG } from "../interface.js";

/**
 * Expand home directory in path
 */
function expandHome(path: string): string {
	if (path.startsWith("~")) {
		return resolve(homedir(), path.slice(1));
	}
	return resolve(path);
}

/**
 * Check if path is under home directory
 */
function isUnderHome(path: string): boolean {
	const expanded = expandHome(path);
	const home = homedir();
	return expanded.startsWith(home);
}

/**
 * Danger Detector class
 */
export class DangerDetector {
	private dangerousPatterns: RegExp[];
	private sensitivePaths: string[];
	private whitelist: string[];

	constructor(config: Partial<SecurityConfig> = {}) {
		const cfg = { ...DEFAULT_SECURITY_CONFIG, ...config };

		// Compile dangerous patterns to regex
		this.dangerousPatterns = cfg.dangerousPatterns.map((p) => new RegExp(p, "i"));

		// Normalize sensitive paths
		this.sensitivePaths = cfg.sensitivePaths.map((p) => expandHome(p));

		// Normalize whitelist
		this.whitelist = cfg.whitelist.map((w) => w.toLowerCase());
	}

	/**
	 * Check if command is dangerous
	 */
	checkCommand(command: string): SecurityCheckResult {
		const normalizedCmd = command.toLowerCase().trim();

		// Check whitelist first
		for (const allowed of this.whitelist) {
			if (normalizedCmd.includes(allowed.toLowerCase())) {
				return {
					allowed: true,
					level: "safe",
					reason: "Command is in whitelist",
				};
			}
		}

		// Check dangerous patterns
		for (const pattern of this.dangerousPatterns) {
			if (pattern.test(command)) {
				return {
					allowed: false,
					level: "dangerous",
					reason: this.getReasonForPattern(pattern.source),
					pattern: pattern.source,
					requiresConfirm: true,
				};
			}
		}

		// Check for potentially dangerous patterns (warnings)
		const warningPatterns = [
			{ pattern: /git\s+reset/i, reason: "Git reset can lose changes" },
			{ pattern: /git\s+checkout\s+--force/i, reason: "Forced checkout can overwrite changes" },
			{ pattern: /\|\s*bash/i, reason: "Piping to shell can be dangerous" },
			{ pattern: />\s*\/dev\//i, reason: "Writing to device file" },
			{ pattern: /npm\s+exec/i, reason: "npm exec can run arbitrary commands" },
			{ pattern: /npm\s+run\s+.*&&/i, reason: "Chained commands after npm run" },
		];

		for (const { pattern, reason } of warningPatterns) {
			if (pattern.test(command)) {
				return {
					allowed: true,
					level: "warning",
					reason,
					pattern: pattern.source,
				};
			}
		}

		// Safe
		return {
			allowed: true,
			level: "safe",
			reason: "Command appears safe",
		};
	}

	/**
	 * Check if file operation is allowed
	 */
	checkFileOperation(operation: "read" | "write" | "edit", path: string): SecurityCheckResult {
		const expandedPath = expandHome(path);

		// Check sensitive paths
		for (const sensitive of this.sensitivePaths) {
			if (expandedPath.includes(sensitive)) {
				return {
					allowed: false,
					level: "dangerous",
					reason: this.getReasonForSensitivePath(sensitive),
					requiresConfirm: true,
				};
			}
		}

		// Check for sensitive file patterns in the path
		const sensitivePatterns = [
			{ pattern: /\.ssh\/id_/, reason: "SSH private key" },
			{ pattern: /\.aws\/credentials/, reason: "AWS credentials" },
			{ pattern: /\.env$/, reason: "Environment file may contain secrets" },
			{ pattern: /\.npmrc$/, reason: "npm config may contain auth tokens" },
			{ pattern: /\.git\/credentials/, reason: "Git credentials" },
			{ pattern: /\/passwords?/i, reason: "Password file" },
			{ pattern: /\/secrets?/i, reason: "Secret file" },
		];

		for (const { pattern, reason } of sensitivePatterns) {
			if (pattern.test(expandedPath)) {
				// Read operations get warning, write/edit get blocked
				if (operation === "read") {
					return {
						allowed: true,
						level: "warning",
						reason,
						requiresConfirm: true,
					};
				} else {
					return {
						allowed: false,
						level: "dangerous",
						reason,
						requiresConfirm: true,
					};
				}
			}
		}

		// Check for dangerous write operations
		if (operation === "write" || operation === "edit") {
			// Check for overwriting system files
			const dangerousPaths = [
				"/etc/",
				"/usr/bin/",
				"/usr/local/bin/",
				"/System/",
				"/Windows/System32/",
			];

			for (const dangerous of dangerousPaths) {
				if (expandedPath.startsWith(dangerous)) {
					return {
						allowed: false,
						level: "dangerous",
						reason: "System directory modification",
						requiresConfirm: true,
					};
				}
			}
		}

		// Safe
		return {
			allowed: true,
			level: "safe",
			reason: "File operation appears safe",
		};
	}

	/**
	 * Get human-readable reason for pattern
	 */
	private getReasonForPattern(pattern: string): string {
		const reasons: Record<string, string> = {
			"rm\\s+-rf": "Recursive deletion can permanently remove files",
			"rmdir\\s+/s": "Recursive directory deletion",
			"del\\s+/s": "Recursive file deletion (Windows)",
			sudo: "sudo gives administrative privileges",
			"chmod\\s+777": "World-writable permissions are insecure",
			"chown\\s+": "Ownership change can break system",
			"kill\\s+-9": "Force kill can cause data loss",
			"pkill\\s+-9": "Force process kill can cause data loss",
			"killall\\s+": "Kill all processes can crash system",
			"curl\\s+.*\\|\\s*sh": "Download and execute is extremely dangerous",
			"wget\\s+.*\\|\\s*sh": "Download and execute is extremely dangerous",
			"Invoke-Expression.*WebRequest": "PowerShell download and execute",
			"git\\s+push\\s+--force": "Force push can overwrite remote history",
			"git\\s+push\\s+-f": "Force push can overwrite remote history",
			"docker\\s+rm\\s+-f": "Force remove container",
			"docker\\s+run\\s+--rm": "Auto-remove container",
			"systemctl\\s+stop": "System service stop",
			"systemctl\\s+restart": "System service restart",
		};

		// Find matching reason
		for (const [key, reason] of Object.entries(reasons)) {
			if (pattern.includes(key)) {
				return reason;
			}
		}

		return "Command matches dangerous pattern";
	}

	/**
	 * Get human-readable reason for sensitive path
	 */
	private getReasonForSensitivePath(path: string): string {
		if (path.includes(".ssh")) {
			return "SSH directory contains private keys";
		}
		if (path.includes(".aws")) {
			return "AWS directory contains credentials";
		}
		if (path.includes(".azure")) {
			return "Azure credentials directory";
		}
		if (path.includes(".gcloud")) {
			return "Google Cloud credentials directory";
		}
		if (path.includes("passwd")) {
			return "System password file";
		}
		if (path.includes("shadow")) {
			return "System shadow file (password hashes)";
		}
		if (path.includes("sudoers")) {
			return "sudo configuration file";
		}
		if (path.includes("git/config")) {
			return "Git configuration may contain credentials";
		}

		return "Path contains sensitive information";
	}

	/**
	 * Update dangerous patterns
	 */
	setDangerousPatterns(patterns: string[]): void {
		this.dangerousPatterns = patterns.map((p) => new RegExp(p, "i"));
	}

	/**
	 * Update sensitive paths
	 */
	setSensitivePaths(paths: string[]): void {
		this.sensitivePaths = paths.map((p) => expandHome(p));
	}

	/**
	 * Update whitelist
	 */
	setWhitelist(whitelist: string[]): void {
		this.whitelist = whitelist.map((w) => w.toLowerCase());
	}
}
