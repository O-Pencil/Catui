#!/usr/bin/env tsx
/**
 * Test script for dream (consolidate) functionality
 */

import { homedir } from "node:os";
import { join } from "node:path";

import { NanoMemEngine } from "./src/engine.js";
import { getConfig } from "./src/config.js";

const memoryDir =
	process.env.NANOMEM_MEMORY_DIR || join(homedir(), ".catui", "agent", "memory");

console.log("Testing dream (consolidate) functionality...");
console.log(`Memory dir: ${memoryDir}`);

// Set consolidationThreshold to 1 for testing
const engine = new NanoMemEngine({ memoryDir, consolidationThreshold: 1 });

async function testDream() {
	// First, check stats
	console.log("\n=== Stats ===");
	const stats = await engine.getStats();
	const v2Stats = await engine.getV2Stats();
	console.log(`Sessions: ${stats.totalSessions}`);
	console.log(`Episodes: ${stats.episodes}`);
	console.log(`V2 Episodes: ${v2Stats.episodes}`);
	console.log(`Knowledge: ${stats.knowledge}`);
	console.log(`Lessons: ${stats.lessons}`);

	// Check if there are unconsolidated episodes
	console.log("\n=== Checking episodes ===");
	// engine internally checks unconsolidated episodes

	// Set a mock LLM function for testing (returns simple extracted memories)
	engine.setLlmFn(async (systemPrompt: string, userMessage: string) => {
		console.log("\n--- LLM called ---");
		console.log(`System prompt length: ${systemPrompt.length}`);
		console.log(`User message length: ${userMessage.length}`);
		console.log(`User message preview: ${userMessage.slice(0, 200)}...`);
		
		// Return a simple mock response
		return JSON.stringify([
			{
				type: "knowledge",
				name: "Test knowledge from consolidation",
				summary: "This is a test knowledge extracted during dream consolidation",
				detail: "Mock consolidation result",
				salience: 0.5,
				retention: "normal",
			}
		]);
	});

	console.log("\n=== Running consolidate (dream) ===");
	try {
		const result = await engine.consolidateDetailed();
		console.log("\n=== Consolidation Result ===");
		console.log(`Episodes considered: ${result.stats.episodesConsidered}`);
		console.log(`Added: ${result.stats.added}`);
		console.log(`Updated: ${result.stats.updated}`);
		console.log(`Skipped: ${result.stats.skipped}`);
		
		if (result.entries.length > 0) {
			console.log("\n=== New Entries ===");
			for (const entry of result.entries.slice(0, 5)) {
				console.log(`- [${entry.type}] ${entry.name || entry.summary || entry.id}`);
			}
		}

		console.log("\n✅ Dream test completed successfully!");
	} catch (err) {
		console.error("\n❌ Dream test failed:", err);
	}

	// Final stats
	console.log("\n=== Final Stats ===");
	const finalStats = await engine.getStats();
	console.log(`Episodes: ${finalStats.episodes}`);
	console.log(`Knowledge: ${finalStats.knowledge}`);
	console.log(`Lessons: ${finalStats.lessons}`);
}

testDream().catch(console.error);