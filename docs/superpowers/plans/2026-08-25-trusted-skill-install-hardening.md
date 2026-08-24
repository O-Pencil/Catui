# Trusted Skill Install Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Block external Git repositories from reaching trusted Catui skill directories even when `git clone` uses value-taking options or omits its destination.

**Architecture:** Keep command policy in the existing `security-audit` extension. Add focused clone-argument and default-target resolution helpers inside `DangerDetector`; do not change core runtime, public types, extension registration, or the general trace format. Record the user-visible default-extension behavior change in a focused architecture review before modifying production code.

**Tech Stack:** TypeScript, Node.js `node:test`, Catui extension API, DIP architecture-review documents

---

## File Map

- Create: `.dev-docs/architecture-review/trusted-skill-install-review/README.md` — scope, decision, ownership, and acceptance contract.
- Create: `.dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md` — concrete parser gap and invariant.
- Create: `.dev-docs/architecture-review/trusted-skill-install-review/closure.md` — open closure gate, finalized after verification.
- Modify: `.dev-docs/architecture-review/README.md` — register the focused review in the architecture-review map.
- Modify: `test/security-audit.test.ts` — regression tests at the real extension `tool_call` boundary.
- Modify: `extensions/builtin/security-audit/engine/detector.ts` — focused Git clone option and destination resolution.

No P2 member list changes are required because no source module or source file is added, removed, or moved. The existing P3 for `detector.ts` already names trusted skill-directory install detection and remains accurate.

### Task 1: Open the Required Focused Architecture Review

**Files:**
- Create: `.dev-docs/architecture-review/trusted-skill-install-review/README.md`
- Create: `.dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md`
- Create: `.dev-docs/architecture-review/trusted-skill-install-review/closure.md`
- Modify: `.dev-docs/architecture-review/README.md`

- [ ] **Step 1: Create the review README**

Create `.dev-docs/architecture-review/trusted-skill-install-review/README.md` with:

````markdown
# Trusted Skill Install Review

```yaml
review_id: trusted-skill-install-review
status: implementation-open
created_at: 2026-08-25
scope:
  - extensions/builtin/security-audit/engine/detector.ts
  - test/security-audit.test.ts
```

## Purpose

Close Git clone parsing gaps that can place an external repository inside a trusted skill directory while preserving ordinary project clones and local repository operations.

## Decision

- `DangerDetector` remains the single owner of trusted skill install policy.
- Parse only the `git clone` argument surface needed to resolve repository and destination.
- Skip known value-taking clone options and stop at shell control operators.
- Resolve explicit destinations against the tool-call working directory.
- Infer Git's default destination from the repository when no destination is supplied.
- Keep Catui's default strict behavior: confirmed external installs into trusted skill roots are blocked without a confirmation override.

## Boundary Rationale

This is extension-owned security policy, not a shared runtime primitive or public protocol. The implementation stays in `extensions/builtin/security-audit/` and adds no dependency, public type, tool field, or prompt.

## Finding Set

| Finding | Status | Purpose |
|---|---|---|
| [SA01](./findings/SA01-git-clone-target-resolution.md) | implementation-open | Resolve clone targets after options and default-target inference |

## Acceptance

- Value-taking clone options cannot hide the repository or target.
- Omitted destinations are inferred under the command working directory.
- External clones into trusted skill roots are blocked.
- Ordinary project clones and local relative repository operations remain allowed.
- Focused tests and all five repository gates pass.
````

- [ ] **Step 2: Create the finding card**

Create `.dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md` with:

```markdown
# SA01 — Git Clone Target Resolution

## Finding

The trusted-skill detector currently treats every non-option token after `git clone` as positional. Options such as `--depth 1` and `-b main` therefore shift the repository and destination slots. A clone without an explicit destination has no target slot at all, even though Git will create a directory below the command working directory.

## Risk

An external repository can be installed into a trusted agent-instruction directory without matching the dedicated security rule. Once present, its instructions can be loaded with trusted skill authority.

## Resolution

Add a focused clone parser that skips known value-taking options, stops at shell command boundaries, identifies the repository, and resolves either the explicit destination or Git's inferred default directory.

## Invariant

When Catui can identify an external Git repository and resolve its clone destination inside a trusted skill root, default strict mode blocks the tool call before execution.

## Non-Goals

- Full POSIX shell parsing.
- Variable, command-substitution, or glob expansion.
- Changing the trusted root list.
- Blocking local relative repository operations solely because their target is a skill directory.
```

- [ ] **Step 3: Create the open closure gate**

Create `.dev-docs/architecture-review/trusted-skill-install-review/closure.md` with:

```markdown
# Trusted Skill Install Review Closure Gate

**Status:** implementation-open

This review closes only after the SA01 invariant is implemented with red-green regression evidence and the repository's DIP, quality, package-boundary, build, and TypeScript gates pass.

## Required Evidence

- Focused extension-boundary tests for value-taking options and inferred destinations.
- Negative coverage for ordinary project clones and local relative repositories.
- No public API, dependency, prompt, or token-cost change.

## Reopen Conditions

Reopen this review if Catui adds a new trusted skill root, accepts non-Git skill installers, or replaces token-based command inspection with a structured execution plan.
```

- [ ] **Step 4: Register the review in the architecture map**

Under the `📦 已结案专项评审` list in `.dev-docs/architecture-review/README.md`, add this implementation-open entry immediately after the existing `bash-pre-execution-approval-decision/` entry:

```markdown
- `trusted-skill-install-review/` — default security extension hardening for external Git clones into trusted skill roots (SA01, implementation-open)
```

- [ ] **Step 5: Verify and commit only the review documents**

Run:

```bash
git diff --check -- .dev-docs/architecture-review/README.md .dev-docs/architecture-review/trusted-skill-install-review
git status --short
```

Expected: no whitespace errors; only the four review-document paths from this task are new or modified by this task. Existing unrelated worktree changes remain unstaged.

Commit:

```bash
git add .dev-docs/architecture-review/README.md .dev-docs/architecture-review/trusted-skill-install-review/README.md .dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md .dev-docs/architecture-review/trusted-skill-install-review/closure.md
git commit -m "docs(security): review trusted skill installs"
```

### Task 2: Add Failing Extension-Boundary Regression Tests

**Files:**
- Modify: `test/security-audit.test.ts`

- [ ] **Step 1: Make the harness accept an explicit working directory**

Change:

```typescript
function createHarness() {
```

to:

```typescript
function createHarness(cwd = tempAgentDir) {
```

and change the context field from:

```typescript
cwd: tempAgentDir,
```

to:

```typescript
cwd,
```

- [ ] **Step 2: Import `homedir` for trusted-root test paths**

Change the Node OS import to:

```typescript
import { homedir, tmpdir } from "node:os";
```

- [ ] **Step 3: Add the failing option and inferred-target tests**

Insert these tests immediately after the existing external skill clone test:

```typescript
test("security-audit blocks skill clones after value-taking long options", async () => {
	const harness = createHarness();
	await securityAuditExtension(harness.api);

	const result = await harness.emitToolCall({
		type: "tool_call",
		toolCallId: "call-skill-clone-depth",
		toolName: "bash",
		input: { command: "git clone --depth 1 https://example.com/untrusted/skill.git ~/skills/evil" },
	});

	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /untrusted skill/i);
});

test("security-audit blocks skill clones after value-taking short options", async () => {
	const harness = createHarness();
	await securityAuditExtension(harness.api);

	const result = await harness.emitToolCall({
		type: "tool_call",
		toolCallId: "call-skill-clone-branch",
		toolName: "bash",
		input: { command: "git clone -b main https://example.com/untrusted/skill.git ~/.claude/skills/evil" },
	});

	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /untrusted skill/i);
});

test("security-audit infers an omitted clone target under a trusted skill cwd", async () => {
	const harness = createHarness(join(homedir(), ".agents", "skills"));
	await securityAuditExtension(harness.api);

	const result = await harness.emitToolCall({
		type: "tool_call",
		toolCallId: "call-skill-clone-inferred",
		toolName: "bash",
		input: { command: "git clone https://example.com/untrusted/skill.git" },
	});

	assert.equal(result?.block, true);
	assert.match(result?.reason ?? "", /untrusted skill/i);
});
```

- [ ] **Step 4: Add negative coverage**

Append:

```typescript
test("security-audit allows external clones into ordinary project directories", async () => {
	const harness = createHarness();
	await securityAuditExtension(harness.api);

	const result = await harness.emitToolCall({
		type: "tool_call",
		toolCallId: "call-project-clone",
		toolName: "bash",
		input: { command: "git clone --depth 1 https://example.com/team/project.git ./vendor/project" },
	});

	assert.equal(result, undefined);
});

test("security-audit does not classify local relative repositories as external installs", async () => {
	const harness = createHarness(join(homedir(), ".agents", "skills"));
	await securityAuditExtension(harness.api);

	const result = await harness.emitToolCall({
		type: "tool_call",
		toolCallId: "call-local-skill-copy",
		toolName: "bash",
		input: { command: "git clone ../reviewed-skill ./reviewed-skill" },
	});

	assert.equal(result, undefined);
});
```

- [ ] **Step 5: Run the focused suite and verify RED**

Run:

```bash
npm run test:security
```

Expected: the three new blocking tests fail because the current parser either treats option values as positional arguments or requires an explicit destination. Existing and negative tests pass. Do not change production code until this failure is observed and recorded.

### Task 3: Implement Focused Clone Destination Resolution

**Files:**
- Modify: `extensions/builtin/security-audit/engine/detector.ts`
- Test: `test/security-audit.test.ts`

- [ ] **Step 1: Add option and shell-boundary constants after `splitShellWords`**

```typescript
const SHELL_CONTROL_WORDS = new Set(["&&", "||", ";", "|", "&"]);

const GIT_CLONE_OPTIONS_WITH_VALUE = new Set([
	"--branch",
	"--config",
	"--depth",
	"--filter",
	"--jobs",
	"--origin",
	"--reference",
	"--reference-if-able",
	"--revision",
	"--separate-git-dir",
	"--server-option",
	"--shallow-exclude",
	"--template",
	"--upload-pack",
	"-b",
	"-c",
	"-j",
	"-o",
	"-u",
]);
```

- [ ] **Step 2: Add focused clone parsing helpers before `isTrustedSkillDirectory`**

```typescript
type GitCloneInvocation = {
	repository: string;
	target: string;
};

function inferGitCloneDirectory(repository: string): string | undefined {
	const withoutSuffix = repository.split(/[?#]/, 1)[0]?.replace(/\/+$/, "") ?? "";
	const separator = Math.max(withoutSuffix.lastIndexOf("/"), withoutSuffix.lastIndexOf(":"));
	const basename = withoutSuffix.slice(separator + 1);
	const directory = basename.endsWith(".git") ? basename.slice(0, -4) : basename;
	return directory && directory !== "." && directory !== ".." ? directory : undefined;
}

function parseGitCloneInvocation(
	words: string[],
	gitIndex: number,
	cwd?: string,
): GitCloneInvocation | undefined {
	const positional: string[] = [];
	let parseOptions = true;
	let skipNext = false;

	for (let index = gitIndex + 2; index < words.length; index += 1) {
		const word = words[index];
		if (SHELL_CONTROL_WORDS.has(word)) break;
		if (skipNext) {
			skipNext = false;
			continue;
		}
		if (parseOptions && word === "--") {
			parseOptions = false;
			continue;
		}
		if (parseOptions && GIT_CLONE_OPTIONS_WITH_VALUE.has(word)) {
			skipNext = true;
			continue;
		}
		if (parseOptions && word.startsWith("-")) continue;
		positional.push(word);
	}

	const repository = positional[0];
	if (!repository) return undefined;
	const targetArgument = positional[1] ?? inferGitCloneDirectory(repository);
	if (!targetArgument) return undefined;
	return {
		repository,
		target: expandPath(targetArgument, cwd),
	};
}
```

- [ ] **Step 3: Replace the old positional extraction in `detectGitCloneIntoTrustedSkillDirectory`**

Replace the function body with:

```typescript
	const words = splitShellWords(command);
	for (let index = 0; index < words.length - 1; index += 1) {
		if (words[index] !== "git" || words[index + 1] !== "clone") continue;
		const invocation = parseGitCloneInvocation(words, index, cwd);
		if (!invocation || !isTrustedSkillDirectory(invocation.target, cwd)) continue;
		const externalRepo = /^(?:https?:\/\/|ssh:\/\/|git@)/i.test(invocation.repository)
			|| (!isAbsolute(invocation.repository) && !invocation.repository.startsWith("."));
		if (!externalRepo) continue;
		return {
			allowed: false,
			level: "dangerous",
			reason: "Installing an untrusted skill repository into a trusted skill directory can execute attacker-controlled agent instructions",
			pattern: "git clone <external> <trusted-skill-dir>",
			requiresConfirm: true,
		};
	}
	return undefined;
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run:

```bash
npm run test:security
```

Expected: every security-audit test passes, including the three formerly failing cases and the two negative cases.

- [ ] **Step 5: Run formatting/whitespace checks and commit the behavioral slice**

Run:

```bash
git diff --check -- extensions/builtin/security-audit/engine/detector.ts test/security-audit.test.ts
git status --short
```

Expected: no whitespace errors; no unrelated file is staged.

Commit:

```bash
git add extensions/builtin/security-audit/engine/detector.ts test/security-audit.test.ts
git commit -m "fix(security): harden trusted skill clone detection"
```

### Task 4: Close the Focused Review with Fresh Evidence

**Files:**
- Modify: `.dev-docs/architecture-review/trusted-skill-install-review/README.md`
- Modify: `.dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md`
- Modify: `.dev-docs/architecture-review/trusted-skill-install-review/closure.md`

- [ ] **Step 1: Mark the review and finding closed**

In `README.md`, change `status: implementation-open` to `status: accepted-and-implemented`, and change the SA01 table status to `closed`.

Append to the SA01 finding:

```markdown
## Evidence

`test/security-audit.test.ts` covers long and short value-taking options, inferred destinations in trusted working directories, ordinary project destinations, and local relative repositories.
```

- [ ] **Step 2: Replace the closure gate with the final closure record**

Replace `closure.md` with:

```markdown
# Trusted Skill Install Review Closure

## Implemented

- Value-taking Git clone options no longer shift repository and destination detection.
- Explicit destinations resolve against the tool-call working directory.
- Omitted destinations derive from the repository name below the working directory.
- External clones into existing trusted skill roots remain strict blocks.
- Ordinary project clones and local relative repository operations retain their prior behavior.

## Boundary Verification

- Implementation remains inside the default `security-audit` extension.
- No public API, protocol type, dependency, model prompt, or trace schema changed.
- The detector uses a focused argument parser and does not claim full shell interpretation.

## Reopen Conditions

Reopen this review if Catui adds a new trusted skill root, accepts non-Git skill installers, or replaces token-based command inspection with a structured execution plan.
```

- [ ] **Step 3: Verify documentation consistency and commit**

Run:

```bash
git diff --check -- .dev-docs/architecture-review/trusted-skill-install-review
npm run verify:dip
```

Expected: no whitespace errors and DIP verification exits 0.

Commit:

```bash
git add .dev-docs/architecture-review/trusted-skill-install-review/README.md .dev-docs/architecture-review/trusted-skill-install-review/findings/SA01-git-clone-target-resolution.md .dev-docs/architecture-review/trusted-skill-install-review/closure.md
git commit -m "docs(security): close trusted skill install review"
```

### Task 5: Run the Full Catui Acceptance Gates

**Files:**
- Verify only; do not intentionally modify files.

- [ ] **Step 1: Run the focused regression suite again**

```bash
npm run test:security
```

Expected: exit 0 with zero failed tests.

- [ ] **Step 2: Run all five mandatory automated gates**

Run each command separately and retain its exit code:

```bash
npm run verify:dip
npm run verify:quality
npm run verify:package-boundary
npm run build
npx tsc --noEmit
```

Expected: all five commands exit 0. If a gate fails because of an unrelated pre-existing worktree change, report that exact evidence; do not conceal or overwrite the user's change.

- [ ] **Step 3: Perform the PR self-check**

Confirm:

- `detector.ts` P3 remains aligned with its responsibility and dependencies.
- `extensions/AGENT.md` and `extensions/builtin/AGENT.md` still accurately describe the same file/member set.
- No public symbol, package dependency, prompt, or LLM call changed.
- Only the focused review, detector, and security test files belong to this delivery.

Run:

```bash
git status --short
git log -4 --oneline
```

Expected: the implementation commits are present; unrelated user files may remain dirty but none are staged by this plan.

## Post-Review Amendment

Independent review identified three valid Git invocation forms beyond the initial parser slice: `clone --bundle-uri <uri>`, global `git -C <path> clone`, and a simple leading `cd <path> && git clone` or `cd <path> ; git clone`. The implementation and focused tests must cover these forms before acceptance. This amendment does not broaden the owner or public surface: effective-directory resolution remains private to `security-audit` and still does not claim complete shell parsing.
