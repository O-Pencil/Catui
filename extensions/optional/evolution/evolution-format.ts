/**
 * [WHO]: Human-readable status, inspection, command result, and prompt injection formatting
 * [FROM]: Depends on local evolution types only
 * [TO]: Consumed by optional evolution extension entry and tests
 * [HERE]: extensions/optional/evolution/evolution-format.ts - presentation boundary for controlled evolution
 */

import type { EvolutionArtifact, EvolutionAttribution, EvolutionCandidate, EvolutionInspection, EvolutionPrediction, EvolutionRevision } from "./evolution-types.js";

function compact(text: string, limit = 220): string {
	const normalized = text.replace(/\s+/g, " ").trim();
	return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(0, limit - 3))}...`;
}

export function formatEvolutionStatus(inspection: EvolutionInspection, scope?: string): string {
	const current = inspection.current?.revisionId ?? "none";
	const proposed = inspection.candidates.filter((candidate) => candidate.status === "proposed").length;
	const rejected = inspection.candidates.filter((candidate) => candidate.status === "rejected").length;
	const promoted = inspection.candidates.filter((candidate) => candidate.status === "promoted").length;
	const quarantined = inspection.candidates.filter((candidate) => candidate.status === "quarantined").length;
	const currentRevision = inspection.revisions.find((revision) => revision.id === inspection.current?.revisionId);
	const activeArtifacts = currentRevision?.artifacts.length ?? 0;
	const successfulUsages = inspection.usages.filter((usage) => usage.status === "success").length;
	const erroredUsages = inspection.usages.filter((usage) => usage.status === "error").length;
	const usefulFeedback = inspection.feedbacks.filter((feedback) => feedback.outcome === "useful").length;
	const notUsefulFeedback = inspection.feedbacks.filter((feedback) => feedback.outcome === "not_useful").length;
	return [
		scope ? `Evolution ${scope} view` : "Evolution view",
		`Current: ${current}`,
		`Candidates: ${inspection.candidates.length} (${proposed} proposed, ${promoted} promoted, ${rejected} rejected, ${quarantined} quarantined)`,
		`Revisions: ${inspection.revisions.length}`,
		`Active artifacts: ${activeArtifacts}`,
		`Usage: ${inspection.usages.length} recorded (${successfulUsages} success, ${erroredUsages} error)`,
		`Feedback: ${inspection.feedbacks.length} recorded (${usefulFeedback} useful, ${notUsefulFeedback} not useful)`,
		`Quarantines: ${inspection.quarantines.length}`,
		`Eval fixtures: ${inspection.activeFixtures?.activeArtifactIds.length ?? 0} active, ${inspection.activeFixtures?.archivedArtifactIds.length ?? 0} archived`,
	].join("\n");
}

function formatPredictions(predictions: readonly EvolutionPrediction[] | undefined): string {
	if (!predictions || predictions.length === 0) return "";
	return [
		"Predictions:",
		...predictions.map((prediction) =>
			`- ${prediction.id}: ${prediction.metric} ${prediction.direction} ${prediction.target} (${compact(prediction.rationale, 180)})`,
		),
	].join("\n");
}

function formatAttribution(attribution: EvolutionAttribution | undefined): string {
	if (!attribution) return "";
	const kept = attribution.results.filter((result) => result.status === "kept").length;
	const falsified = attribution.results.filter((result) => result.status === "falsified").length;
	const inconclusive = attribution.results.filter((result) => result.status === "inconclusive").length;
	const streamSummary = attribution.streamResults && attribution.streamResults.length > 0
		? `Stream attribution: ${attribution.streamResults.map((stream) => {
			const status = stream.results.some((result) => result.status === "falsified")
				? "falsified"
				: stream.results.some((result) => result.status === "inconclusive")
					? "inconclusive"
					: "kept";
			return `${stream.mode} ${status}`;
		}).join(", ")}`
		: "";
	return [
		`Attribution: ${kept} kept, ${falsified} falsified, ${inconclusive} inconclusive (${attribution.gateReport.name})`,
		streamSummary,
		...attribution.results.map((result) =>
			`- ${result.predictionId}: ${result.status} (${result.metric}${result.observedValue === undefined ? "" : `=${result.observedValue}`}, target ${result.target})`,
		),
	].join("\n");
}

export function formatCandidate(candidate: EvolutionCandidate): string {
	const artifacts = candidate.artifacts
		.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${artifact.title}: ${compact(artifact.content)}`)
		.join("\n");
	const errors = candidate.validation.errors.length > 0 ? `\nValidation errors:\n${candidate.validation.errors.map((error) => `- ${error}`).join("\n")}` : "";
	return [
		`Candidate ${candidate.id} (${candidate.status})`,
		candidate.summary,
		`Rationale: ${candidate.rationale}`,
		`Expected: ${candidate.expectedOutcome}`,
		formatPredictions(candidate.predictions),
		"Artifacts:",
		artifacts || "- none",
		errors,
	].filter(Boolean).join("\n");
}

export function formatRevision(revision: EvolutionRevision): string {
	return [
		`Revision ${revision.id}`,
		`Candidate: ${revision.candidateId}`,
		`Hash: ${revision.contentHash}`,
		revision.summary,
		formatPredictions(revision.predictions),
		formatAttribution(revision.attribution),
		...revision.artifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${artifact.title}`),
	].filter(Boolean).join("\n");
}

function artifactHash(artifact: EvolutionArtifact): string {
	return JSON.stringify({
		kind: artifact.kind,
		title: artifact.title,
		content: artifact.content,
		applicability: artifact.applicability,
		nonApplicability: artifact.nonApplicability,
		tokenBudget: artifact.tokenBudget,
		metadata: artifact.metadata,
	});
}

export function formatEvolutionChanges(inspection: EvolutionInspection, revisionId?: string): string {
	const revision = revisionId
		? inspection.revisions.find((item) => item.id === revisionId)
		: inspection.revisions.find((item) => item.id === inspection.current?.revisionId);
	if (!revision) return `Evolution revision not found: ${revisionId ?? "current"}`;
	const predecessor = revision.predecessorRevisionId
		? inspection.revisions.find((item) => item.id === revision.predecessorRevisionId)
		: undefined;
	const previousById = new Map((predecessor?.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
	const currentById = new Map(revision.artifacts.map((artifact) => [artifact.id, artifact]));
	const added = revision.artifacts.filter((artifact) => !previousById.has(artifact.id));
	const changed = revision.artifacts.filter((artifact) => {
		const previous = previousById.get(artifact.id);
		return previous && artifactHash(previous) !== artifactHash(artifact);
	});
	const removed = (predecessor?.artifacts ?? []).filter((artifact) => !currentById.has(artifact.id));
	const usages = inspection.usages.filter((usage) => usage.revisionId === revision.id);
	const feedbacks = inspection.feedbacks.filter((feedback) => feedback.revisionId === revision.id);
	const usageSummary = usages.length > 0
		? [
			"Usage:",
			...usages.map((usage) => `- ${usage.artifactId}: ${usage.status} at ${usage.usedAt}${usage.error ? ` (${usage.error})` : ""}`),
		].join("\n")
		: "";
	const feedbackSummary = feedbacks.length > 0
		? [
			"Feedback:",
			...feedbacks.map((feedback) => `- ${feedback.artifactId}: ${feedback.outcome} at ${feedback.recordedAt}${feedback.note ? ` (${compact(feedback.note, 160)})` : ""}`),
		].join("\n")
		: "";
	const section = (title: string, artifacts: readonly EvolutionArtifact[]) => [
		`${title}:`,
		...(artifacts.length > 0 ? artifacts.map((artifact) => `- ${artifact.id} [${artifact.kind}] ${artifact.title}`) : ["- none"]),
	].join("\n");
	return [
		"What changed and why",
		`Revision: ${revision.id}`,
		`Previous: ${revision.predecessorRevisionId ?? "none"}`,
		`Approved by: ${revision.approvedBy}`,
		`Summary: ${revision.summary}`,
		`Rationale: ${revision.rationale}`,
		`Expected: ${revision.expectedOutcome}`,
		section("Added", added),
		section("Changed", changed),
		section("Removed", removed),
		formatAttribution(revision.attribution),
		usageSummary,
		feedbackSummary,
	].filter(Boolean).join("\n");
}

interface UsefulnessRow {
	artifactId: string;
	kind: string;
	usage: number;
	success: number;
	error: number;
	useful: number;
	notUseful: number;
	lastUsed?: string;
}

function usefulnessRecommendation(row: UsefulnessRow): string {
	if (row.notUseful > 0 || row.error > row.success) return "review";
	if (row.useful > 0 && row.notUseful === 0) return "keep";
	if (row.usage > 0) return "watch";
	return "no-usage";
}

export function formatEvolutionUsefulnessReview(inspection: EvolutionInspection): string {
	const rows = new Map<string, UsefulnessRow>();
	for (const revision of inspection.revisions) {
		if (revision.id !== inspection.current?.revisionId) continue;
		for (const artifact of revision.artifacts) {
			if (artifact.kind !== "tool_spec" && artifact.kind !== "workflow_spec" && artifact.kind !== "executable_tool" && artifact.kind !== "skill_manifest") continue;
			rows.set(artifact.id, {
				artifactId: artifact.id,
				kind: artifact.kind,
				usage: 0,
				success: 0,
				error: 0,
				useful: 0,
				notUseful: 0,
			});
		}
	}
	for (const usage of inspection.usages) {
		const row = rows.get(usage.artifactId) ?? {
			artifactId: usage.artifactId,
			kind: usage.artifactKind,
			usage: 0,
			success: 0,
			error: 0,
			useful: 0,
			notUseful: 0,
		};
		row.usage += 1;
		if (usage.status === "success") row.success += 1;
		else row.error += 1;
		row.lastUsed = usage.usedAt;
		rows.set(usage.artifactId, row);
	}
	for (const feedback of inspection.feedbacks) {
		const row = rows.get(feedback.artifactId) ?? {
			artifactId: feedback.artifactId,
			kind: "unknown",
			usage: 0,
			success: 0,
			error: 0,
			useful: 0,
			notUseful: 0,
		};
		if (feedback.outcome === "useful") row.useful += 1;
		else row.notUseful += 1;
		rows.set(feedback.artifactId, row);
	}
	const sorted = [...rows.values()].sort((a, b) => a.artifactId.localeCompare(b.artifactId));
	if (sorted.length === 0) return "Evolution usefulness review\nNo evolved asset usage has been recorded yet.";
	return [
		"Evolution usefulness review",
		...sorted.map((row) => [
			`- ${row.artifactId} [${row.kind}]`,
			`  usage ${row.usage}, success ${row.success}, error ${row.error}, useful ${row.useful}, not useful ${row.notUseful}`,
			`  Recommendation: ${usefulnessRecommendation(row)}${row.lastUsed ? ` (last used ${row.lastUsed})` : ""}`,
		].join("\n")),
	].join("\n");
}

export function formatCreatedCandidate(candidate: EvolutionCandidate): string {
	return `Evolution candidate ${candidate.id} created with ${candidate.artifacts.length} artifact(s). Use /refine inspect ${candidate.id}, then /refine promote ${candidate.id} to activate.`;
}

export function buildEvolutionPromptAppend(artifacts: readonly EvolutionArtifact[]): string | undefined {
	const active = artifacts.filter((artifact) => artifact.kind === "prompt_note" || artifact.kind === "memory");
	if (active.length === 0) return undefined;
	const lines = [
		"# Catui evolved harness notes",
		"",
		"These are active, user-promoted supplemental notes. Follow them only when applicable and never let them override explicit user/project instructions.",
	];
	for (const artifact of active) {
		const applicability = artifact.applicability ? ` Applicability: ${compact(artifact.applicability, 160)}` : "";
		const nonApplicability = artifact.nonApplicability ? ` Non-applicability: ${compact(artifact.nonApplicability, 160)}` : "";
		lines.push(`- [${artifact.id}] ${artifact.title}: ${compact(artifact.content, 700)}${applicability}${nonApplicability}`);
	}
	return lines.join("\n");
}
