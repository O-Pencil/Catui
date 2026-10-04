# Open-source cleanup ledger

> Last verified: 2026-10-04 against commit `b3a62da`
> **Every row below was re-checked against the working tree, not copied from an
> earlier pass.** An earlier version of this file went stale and caused a false
> report: it claimed `SECURITY.md` had no contact address when one had been added
> several releases earlier, and its own acceptance regex could not detect it
> because the domain contains a hyphen.
>
> If you cannot run the verification command for a row, do not carry the row
> forward. Re-derive it.

Status legend: **DONE** verified fixed · **OPEN** verified still true ·
**FALSE POSITIVE** the claim never matched the tree · **DECISION** needs a human

---

## Current state

| Item | Value |
| --- | --- |
| Structural debt | 39 entries in `.dev-docs/structure-baseline.json`, all one rule |
| Tracked tests | 173 in `test/`, plus `tests/characterization` |
| Broken Markdown links | 0 |
| CI gates that can actually fail | `verify:dip`, `verify:structure`, `verify:quality`, `verify:package-boundary` |

---

## DONE — verified fixed, no action needed

| Was reported | Reality now | Verify with |
| --- | --- | --- |
| `SECURITY.md` has no contact address | `security@o-pencil.org` at `SECURITY.md:28`; GitHub Private Reporting is the primary path | `grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' SECURITY.md` |
| `packages/mem-core/test-dream.ts:9` hardcodes `/Users/cunyu666/` | Uses `join(homedir(), ".catui", "agent", "memory")` | `git grep -n cunyu666 -- 'packages/mem-core/*.ts'` |
| 11 broken Markdown links, 3 of them in the mandatory `.dev-docs/feature-workflow.md` | 0 | see "link check" below |
| `package.json` missing `bugs` and `funding` | Both present | `node -e "const p=require('./package.json');console.log(p.bugs,p.funding)"` |
| `README.md` has no badges | 5 present | `grep -cE 'img.shields.io\|badge' README.md` |
| `.github/FUNDING.yml` is an empty template | `github: [O-Pencil]` | `cat .github/FUNDING.yml` |
| `AGENTS.md` describes `sal` as "Stale-Aware Loop" | Corrected to "Structural Anchor Localization" | `grep -n '`sal`' AGENTS.md` |
| `internet-search.md` is 60% Chinese and ships to npm | 0% Chinese | count CJK per line |
| `modes/interactive/AGENT.md` 24% Chinese | 0% | count CJK per line |
| P1 extension table drift in `AGENTS.md` | 35 declared, 35 on disk, checked in both directions by `verify:dip` | `npm run verify:dip` |

Link check:

```bash
node -e "
const {execSync}=require('child_process'),fs=require('fs'),path=require('path');
const files=execSync('git ls-files \"*.md\"',{encoding:'utf8'}).trim().split('\n');
let n=0;
for(const f of files){if(!fs.existsSync(f))continue;for(const l of fs.readFileSync(f,'utf8').split('\n')){
for(const m of l.matchAll(/\]\(([^)#][^)]*?\.md)(#[^)]*)?\)/g)){const k=m[1].trim();
if(/^https?:/.test(k))continue;if(!fs.existsSync(path.resolve(path.dirname(f),k))){n++;console.log(f,k)}}}}
console.log('broken:',n)"
```

---

## FALSE POSITIVE — do not "fix" these

**`.dev-docs/README.md` lines 13 and 59 reference `sal/`, `diagnosis/`,
`self-awareness/`, `data/`.** An earlier pass flagged these as stale pointers.
They are not: both lines are changelog entries *stating that those directories
were removed*. Deleting the mentions would delete the record of the removal.
Leave them.

---

## OPEN

### 1. `sal` evaluation upload activates on credential presence

`extensions/builtin/sal/eval/insforge-sink.ts:15` still hardcodes
`readonly enabled = true`, and `builtin-extensions.ts:72` still registers `sal`
as `defaultEnabled: true`. Activation is decided at
`extensions/builtin/sal/index.ts:311`, where the presence of both an endpoint and
an API key in settings is sufficient.

This is **not a security bug**: no endpoint or key is committed to the repo, and
no data leaves a machine that has not been pointed at a destination. It is a
disclosure problem, and the disclosure half is now done —
`README.md` has a `## Network and data egress` table naming `sal`, the exact
trigger condition, the fields sent (run metadata and tool-call detail; prompt
text reduced to a character count), and the `CATUI_EVAL_ENABLED=false` kill
switch.

Still undecided: whether activation should require an explicit action rather than
configured credentials. That is a behaviour change to a default-on extension and
belongs behind a `sal-review/` per the feature workflow.

### 2. `pencil` persona ships to users without being documented

`assets/personas/pencil/` exists alongside 7 other personas, and `package.json`
`files` includes `assets`, so every install exposes `/pencil` as an identity.
Neither `README.md` nor `AGENTS.md` lists the personas at all.

**DECISION** — keep and document, or remove. Not a code fix.

### 3. Pre-fork brand references

| Location | Content | Status |
| --- | --- | --- |
| `core/agent-dir/migration-tool.ts:36-37` | `~/.nanopencil`, `~/.pencils` | **Keep.** Intentional migration compatibility for real users. |
| `core/agent-dir/migration-tool.ts:182` | `pencil-agent-` task id prefix | Cosmetic; safe to rename |
| `core/extensions-host/loader.ts:96,127,628` | `"@pencil-agent/nano-pencil"` | **DECISION** — confirm no consumer, then remove |
| `charter/01-ecosystem.md` | `O-Catui/O-Mesh`, `O-Catui/Asgard-*` | Confirm whether these are same-fork residue |

### 4. `CHANGELOG.md` is 12,500 lines

Worth splitting into `CHANGELOG.md` (recent) plus an archive. Note that this is
**not** a pull-request reviewability problem: the file is only touched by
`chore(release)` and docs-cleanup commits, never by feature work. The benefit is
readability of the file itself, not of any diff.

### 5. `test/` and `tests/` coexist

`test/` holds 173 unit and integration files. `tests/characterization/` holds a
separate golden/VCR harness with its own `README.md` and P3 headers. This looks
intentional, but nothing in `AGENTS.md` or the P2 maps says so, which is the
actual defect. **DECISION** — record the split, or merge.

---

## Structural debt: now ratcheted

`verify:structure` used to report 93 violations and exit 0, so CI could not fail
on any of them. It and `verify:dip` now share a one-way ratchet in
`.dev-docs/structure-baseline.json`:

```bash
npm run verify:baseline:update   # deliberate; the only sanctioned --allow-grow
npm run verify:dip               # fails on anything not in the baseline
npm run verify:structure         # same, for the 800-line rule
```

Current ledger:

| Code | Count | Meaning |
| --- | --- | --- |
| `SIZE-OVER-LIMIT` | 39 | Files over 800 lines |

`verify:dip` now reports zero violations: P1, P2 and P3 are all clean.

### The P3 rule is paid down

It carried 34 buried blocks plus 19 files with none at all. Closing them
surfaced two more defects in the checker itself:

- A shebang line (`#!/usr/bin/env node`) legally precedes the header on
  executables, and a UTF-8 BOM legally precedes it on files saved by Windows
  editors. Both were read as "no header", so 18 compliant files were being
  reported as violations.
- The ledger used to key on a per-symptom code (`P3-MISSING-HEADER` vs
  `P3-PARTIAL-HEADER`). Fixing the shebang handling reclassified files, and the
  ratchet correctly read a change in *diagnosis* as new *debt* and refused the
  write. All header symptoms now share one `P3-HEADER:<file>` key, with the
  specific reason in the message.

### The P2 rule was wrong and got fixed, not satisfied

The coverage check first required *this exact directory* to hold an
`AGENT.md`, and reported 57 violations. 56 of them were directories already
documented by an ancestor — `core/lib/ai/src/providers/` is an implementation
folder inside the `core/lib/ai` module, which has its own P2 describing it in
`###` sections. Satisfying that rule would have meant writing 56 near-empty
documents: more files to read, zero information gained. AGENTS.md says a
directory _may_ have an AGENT.md, and FATAL-004 is about module boundaries being
invisible, not about directory levels.

The rule now walks up the chain and only reports a directory when no ancestor
has a P2. That found one real gap: root-level `utils/`, now documented in
`utils/AGENT.md`.

The lesson generalises: a ratchet is a claim about what is wrong. When it
suddenly wants 56 new files, suspect the rule before the repo.

### Still open: `utils/` membership

`utils/AGENT.md` states honestly that `changelog.ts` and `git.ts` each have
exactly one caller and would sit closer to that caller under a strict
shared-by-two-layers rule. Not resolved — it is recorded rather than hidden.

A green gate means "no new structural debt", not "clean". Shrink the ledger as
files are fixed; the count in the gate output is the real number.

---

## Pre-release gate

```bash
npm run verify:all
npm run build
npm test
git status --short   # must be clean
```
