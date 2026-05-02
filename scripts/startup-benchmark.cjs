/**
 * Startup benchmark script
 * 
 * Usage:
 *   node scripts/startup-benchmark.cjs --runs 10 --output results.json
 *   node scripts/startup-benchmark.cjs --baseline .benchmarks/baseline.json --compare
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

// Parse arguments
const args = process.argv.slice(2);
let runs = 5;
let outputFile = null;
let baselineFile = null;
let compareMode = false;

for (let i = 0; i < args.length; i++) {
	if (args[i] === "--runs" && i + 1 < args.length) {
		runs = parseInt(args[++i], 10);
	} else if (args[i] === "--output" && i + 1 < args.length) {
		outputFile = args[++i];
	} else if (args[i] === "--baseline" && i + 1 < args.length) {
		baselineFile = args[++i];
	} else if (args[i] === "--compare") {
		compareMode = true;
	}
}

// Get CLI path
const isProduction = fs.existsSync(path.join(__dirname, "../dist/cli.js"));
const cliPath = isProduction
	? path.join(__dirname, "../dist/cli.js")
	: path.join(__dirname, "../cli.ts");

function runCLI(env = {}) {
	return new Promise((resolve, reject) => {
		const startTime = Date.now();
		
		// Use --help to go through full startup flow (--version exits early)
		// We need to run it directly to capture full profile output
		const proc = spawn(
			"node",
			isProduction 
				? ["--eval", `import('./dist/main.js').then(m => m.main(['--help']))`]
				: ["--import", "tsx", "--eval", `import('./main.ts').then(m => m.main(['--help']))`],
			{
				cwd: path.join(__dirname, ".."),
				env: { ...process.env, NANOPENCIL_PROFILE_STARTUP: "1", ...env },
				stdio: ["ignore", "pipe", "pipe"],
			}
		);

		let stdout = "";
		let stderr = "";

		proc.stdout.on("data", (d) => { stdout += d; });
		proc.stderr.on("data", (d) => { stderr += d; });

		proc.on("close", (code) => {
			const endTime = Date.now();
			const wallTime = endTime - startTime;

			// Parse profile data from stderr
			const profileLines = stderr.split("\n").filter((l) => l.startsWith("[profile]"));
			const checkpoints = profileLines.map((l) => {
				const match = l.match(/\[profile\] (.+?): ([\d.]+)ms/);
				if (match) {
					return { name: match[1], time: parseFloat(match[2]) };
				}
				return null;
			}).filter(Boolean);

			resolve({
				code,
				wallTime,
				stdout: stdout.trim(),
				checkpoints,
				profileLines,
			});
		});

		proc.on("error", reject);
	});
}

async function run() {
	console.log(`🚀 Running startup benchmark (${runs} runs)...\n`);

	const results = [];
	const errors = [];

	for (let i = 0; i < runs; i++) {
		process.stdout.write(`  Run ${i + 1}/${runs}... `);
		try {
			const result = await runCLI();
			results.push(result);
			console.log(`✓ ${result.wallTime}ms (checkpoints: ${result.checkpoints.length})`);
		} catch (err) {
			console.log(`✗ Error: ${err.message}`);
			errors.push(err);
		}
	}

	if (results.length === 0) {
		console.error("\n❌ No successful runs. Cannot generate benchmark.");
		process.exit(1);
	}

	// Analyze results
	const wallTimes = results.map((r) => r.wallTime);
	const avgWallTime = wallTimes.reduce((a, b) => a + b, 0) / results.length;
	const minWallTime = Math.min(...wallTimes);
	const maxWallTime = Math.max(...wallTimes);
	const stdDev = Math.sqrt(
		wallTimes.reduce((sum, t) => sum + Math.pow(t - avgWallTime, 2), 0) / results.length
	);

	// Aggregate checkpoint timings
	const checkpointTimes = new Map();
	for (const result of results) {
		for (const cp of result.checkpoints) {
			if (!checkpointTimes.has(cp.name)) {
				checkpointTimes.set(cp.name, []);
			}
			checkpointTimes.get(cp.name).push(cp.time);
		}
	}

	const checkpointStats = [];
	for (const [name, times] of checkpointTimes) {
		const avg = times.reduce((a, b) => a + b, 0) / times.length;
		const min = Math.min(...times);
		const max = Math.max(...times);
		checkpointStats.push({ name, avg, min, max });
	}

	// Calculate deltas between checkpoints (phase durations)
	const phaseStats = new Map();
	for (const result of results) {
		const sorted = [...result.checkpoints].sort((a, b) => a.time - b.time);
		for (let i = 1; i < sorted.length; i++) {
			const phaseName = sorted[i].name;
			const delta = sorted[i].time - sorted[i - 1].time;
			if (!phaseStats.has(phaseName)) {
				phaseStats.set(phaseName, []);
			}
			phaseStats.get(phaseName).push(delta);
		}
	}

	const phases = [];
	for (const [name, times] of phaseStats) {
		const avg = times.reduce((a, b) => a + b, 0) / times.length;
		phases.push({ name, avgMs: avg });
	}
	phases.sort((a, b) => b.avgMs - a.avgMs);

	// Generate report
	const report = {
		timestamp: new Date().toISOString(),
		runs: results.length,
		errors: errors.length,
		wallTime: {
			avg: Math.round(avgWallTime),
			min: minWallTime,
			max: maxWallTime,
			stdDev: Math.round(stdDev),
		},
		checkpoints: checkpointStats.map((cp) => ({
			name: cp.name,
			avgMs: Math.round(cp.avg),
			minMs: Math.round(cp.min),
			maxMs: Math.round(cp.max),
		})),
		phases: phases.slice(0, 10).map((p) => ({
			name: p.name,
			avgMs: Math.round(p.avgMs),
			pct: Math.round((p.avgMs / avgWallTime) * 100),
		})),
	};

	// Print summary
	console.log("\n📊 Benchmark Results");
	console.log("─".repeat(50));
	console.log(`  Total runs:      ${results.length}`);
	console.log(`  Wall time avg:   ${report.wallTime.avg}ms`);
	console.log(`  Wall time min:   ${report.wallTime.min}ms`);
	console.log(`  Wall time max:   ${report.wallTime.max}ms`);
	console.log(`  Std deviation:   ${report.wallTime.stdDev}ms`);

	if (checkpointStats.length > 0) {
		console.log("\n⏱️  Checkpoint Timings (avg time from start)");
		console.log("─".repeat(50));
		for (const cp of checkpointStats) {
			const pct = Math.round((cp.avg / avgWallTime) * 100);
			console.log(`  ${cp.name.padEnd(35)} ${String(Math.round(cp.avg)).padStart(6)}ms (${pct}%)`);
		}
	}

	if (phases.length > 0) {
		console.log("\n🔥 Top 10 Phases (by duration between checkpoints)");
		console.log("─".repeat(50));
		for (const phase of phases.slice(0, 10)) {
			const pct = Math.round((phase.avgMs / avgWallTime) * 100);
			console.log(`  ${phase.name.padEnd(35)} ${Math.round(phase.avgMs).toString().padStart(6)}ms (${pct}%)`);
		}
	}

	// Compare with baseline if specified
	if (baselineFile && fs.existsSync(baselineFile)) {
		const baseline = JSON.parse(fs.readFileSync(baselineFile, "utf-8"));
		const baselineAvg = baseline.wallTime.avg;

		const diff = report.wallTime.avg - baselineAvg;
		const diffPercent = baselineAvg > 0 ? (diff / baselineAvg) * 100 : 0;

		console.log("\n📈 Comparison with Baseline");
		console.log("─".repeat(50));
		console.log(`  Baseline avg:    ${baselineAvg}ms`);
		console.log(`  Current avg:     ${report.wallTime.avg}ms`);
		console.log(`  Difference:      ${diff >= 0 ? "+" : ""}${diff}ms (${diffPercent >= 0 ? "+" : ""}${diffPercent.toFixed(1)}%)`);

		// Check for regressions
		const THRESHOLD = 10; // 10% threshold
		const regressions = [];
		for (const phase of report.phases) {
			const baselinePhase = baseline.phases?.find((b) => b.name === phase.name);
			if (baselinePhase) {
				const phaseDiff = phase.avgMs - baselinePhase.avgMs;
				const phaseDiffPercent = baselinePhase.avgMs > 0 ? (phaseDiff / baselinePhase.avgMs) * 100 : 0;
				if (phaseDiffPercent > THRESHOLD && phaseDiff > 10) {
					regressions.push({ name: phase.name, diff: phaseDiff, pct: phaseDiffPercent });
				}
			}
		}

		if (regressions.length > 0) {
			console.log("\n⚠️  REGRESSIONS DETECTED");
			console.log("─".repeat(50));
			for (const reg of regressions) {
				console.log(`  ❌ ${reg.name}: +${Math.round(reg.diff)}ms (+${reg.pct.toFixed(1)}%)`);
			}
			console.log("\n💡 Run the benchmark with --output to save results.");
			console.log("   Commit the new baseline after reviewing changes.");
		} else {
			console.log("\n✅ No regressions detected!");
		}
	}

	// Save to output file if specified
	if (outputFile) {
		fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
		console.log(`\n💾 Results saved to: ${outputFile}`);
	}

	console.log();
}

run().catch(console.error);