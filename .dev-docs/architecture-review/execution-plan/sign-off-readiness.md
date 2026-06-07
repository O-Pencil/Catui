# Sign-off Readiness Runbook

```yaml
phase: sign-off-readiness
branch: refactor/arch-candidate-d
status: ready-for-maintainer-validation
owner: maintainer-on-capable-machine
updated_at: 2026-06-07
```

## Purpose

This runbook converts the remaining refactor gates into commands and pass/fail records.

Use it before signing [sign-off-main.md](./sign-off-main.md). The goal is not to start new refactor work; it is to prove the branch is stable enough to merge or to isolate only blocking validation failures.

## Policy

- Run heavy commands only on a capable machine.
- Do not merge `refactor/arch-candidate-d` into `main` before S-1..S-6 are filled.
- Fix only validation blockers. Do not reopen P7 or start P8 unless explicitly accepted.
- For prerelease publish checks, use `--tag beta`.

## Quick State

| Area | Current State | Required Before Sign-off |
|------|---------------|--------------------------|
| P7 | closed-as-gated | No more P7 code unless reopened by closure matrix |
| package boundary | BR01 guard landed | static + dist guard pass |
| browser | UX-first, no raw harness split | browser remains opt-in and discoverable |
| model metadata | metrics-gated | no split unless metrics justify |
| esbuild | reviewed-deferred | no bundling in current branch |

## Command Set A: Required Build And Static Gates

Run from repo root on the capable machine:

```bash
git checkout refactor/arch-candidate-d
git pull --rebase origin refactor/arch-candidate-d

npm run build
npx tsc --noEmit
npm run verify:quality
npm run verify:dip
npm run verify:package-boundary
npm run verify:package-boundary:dist
```

Pass criteria:

- all commands exit 0.
- `verify:package-boundary:dist` confirms embedded private libs resolve from `dist/main.js`.
- no `extensions/defaults` path regression.
- no package/extension load error appears during build-related scripts.

Record:

```yaml
build_static:
  npm_run_build: pass | fail
  tsc_no_emit: pass | fail
  verify_quality: pass | fail
  verify_dip: pass | fail
  verify_package_boundary: pass | fail
  verify_package_boundary_dist: pass | fail
  notes: ""
```

## Command Set B: Package / Publish Smoke

This checks the package boundary without actually publishing unless you choose to.

```bash
npm publish --dry-run --tag beta
```

If publishing a prerelease beta:

```bash
npm publish --tag beta
```

Fresh install smoke:

```bash
npm uninstall -g @pencil-agent/nano-pencil
npm install -g @pencil-agent/nano-pencil@beta
nanopencil -v
```

Pass criteria:

- dry-run includes `dist/**/*.js`, `dist/**/*.d.ts`, `dist/**/*.json`, and required runtime assets.
- fresh global install succeeds.
- `nanopencil -v` exits without package-resolution or extension-load errors.
- no errors like missing `@pencil-agent/ai`, missing `./config.js`, or `No "exports" main defined`.

Record:

```yaml
package_smoke:
  publish_dry_run_tag_beta: pass | fail
  fresh_global_install_beta: pass | fail
  nanopencil_version_smoke: pass | fail
  published_version_tested: ""
  notes: ""
```

## Command Set C: Characterization / Regression Tests

Run these after build/static gates pass.

```bash
npx vitest run --config tests/characterization/vitest.config.ts
npx vitest run
```

If characterization replay reports missing cassette files, that is not a refactor failure by itself. Record it as baseline data missing and regenerate from frozen `main` only if maintainers decide the characterization gate is required for sign-off.

Pass criteria:

- characterization replay passes, or missing-cassette status is explicitly accepted and documented.
- full vitest either passes or failures are triaged as pre-existing/non-blocking with evidence.

Record:

```yaml
tests:
  characterization: pass | missing-cassette | fail | skipped
  full_vitest: pass | fail | skipped
  notes: ""
```

## Command Set D: API / Wiki Isomorphism

This covers S-1 and GA-2.

```bash
npm run wiki:all
```

Then compare public symbols with the frozen baseline:

```bash
diff <(grep -oE '^[^ ]+' .baseline-out/public-api-symbols.txt | sort) \
     <(sort .dev-docs/architecture-review/baseline/public-api-symbols-main.txt)
```

Pass criteria:

- `npm run wiki:all` exits 0.
- public API symbol set is unchanged, or any diff is documented as intentional and accepted.
- DIP / wiki generated docs remain structurally isomorphic.

Record:

```yaml
api_wiki:
  wiki_all: pass | fail
  public_symbols_diff: none | path-only | intentional | fail
  diff_summary: ""
```

## Command Set E: Startup / Size Metrics

Use these to fill S-4 and P6 DoD. `--version` and `--help` are fast paths and must not be used for P6 startup measurement.

Preferred:

```bash
hyperfine -w3 -r10 'node dist/cli.js --list-models'
du -sh dist
npm publish --dry-run --tag beta
```

Fallback without `hyperfine`:

```bash
for i in 1 2 3 4 5; do time node dist/cli.js --list-models >/dev/null; done
du -sh dist
npm publish --dry-run --tag beta
```

Pass criteria:

- cold startup is not worse than accepted baseline in `REFACTOR-LEDGER.md`.
- dist/package size changes match known accepted trade-offs:
  - browser assets are now correctly included after D1/D2 fix.
  - P5 structural split adds files but should not break runtime behavior.
- no new size win is claimed unless before/after tarball and unpacked data are attached.

Record:

```yaml
metrics:
  list_models_mean: ""
  list_models_min: ""
  dist_du: ""
  publish_dry_run_size_summary: ""
  notes: ""
```

## Command Set F: Mode And User-State Smoke

These are partly manual. Keep them shallow; this is a sign-off smoke, not exhaustive exploratory testing.

Suggested smoke:

```bash
node dist/cli.js --list-models
node dist/cli.js --print "hello"
```

Manual checks:

| Mode / Area | Check | Pass Criteria |
|-------------|-------|---------------|
| interactive | launch TUI, open `/model`, `/settings`, `/tree`, `/browser` fallback | no crash; overlays render; browser remains opt-in |
| print | simple prompt path | process completes or fails only for expected missing provider credentials |
| rpc/acp | launch smoke if local harness exists | no import/path crash |
| user config | run with existing `~/.pencils/agents/` | old auth/settings/session layout still readable |
| extension loading | default extensions + optional extension path if available | no package-resolution or jiti alias errors |

Record:

```yaml
mode_smoke:
  list_models: pass | fail
  print_mode: pass | fail | provider-missing
  interactive_tui: pass | fail | skipped
  rpc: pass | fail | skipped
  acp: pass | fail | skipped
  user_config_compat: pass | fail | skipped
  extension_loading: pass | fail
  notes: ""
```

## Command Set G: Provider Smoke

Provider smoke requires credentials and should be scoped to available providers.

Minimum recommended matrix:

| API Group | Example | Required If Credentials Available |
|-----------|---------|------------------------------------|
| openai-completions | custom/OpenAI-compatible or token-plan | yes |
| openai-responses | OpenAI | yes if configured |
| anthropic-messages | Anthropic or token-plan | yes if configured |
| google-generative-ai | Google | optional |
| bedrock-converse-stream | Amazon Bedrock | optional |
| OAuth-backed | GitHub Copilot or OpenAI Codex | optional |

Pass criteria:

- first use of provider runtime succeeds after lazy load.
- missing credential errors remain clear/actionable.
- token usage/cost fields do not disappear for successful provider calls.

Record:

```yaml
provider_smoke:
  openai_completions: pass | fail | unavailable
  openai_responses: pass | fail | unavailable
  anthropic_messages: pass | fail | unavailable
  google_generative_ai: pass | fail | unavailable
  bedrock_converse_stream: pass | fail | unavailable
  oauth_backed: pass | fail | unavailable
  notes: ""
```

## Final Sign-off Mapping

| Sign-off Gate | Evidence Source |
|---------------|-----------------|
| S-1 功能不变 | Command Set C + D + mode smoke |
| S-2 分层清晰 | `verify:quality`, zero cycles, review docs |
| S-3 无冗余 | P4/P5 review closeouts + `verify:quality` |
| S-4 性能 | Command Set E |
| S-5 接缝 | runtime-session-review, interactive-ui-review, bundle-redesign-review closure |
| S-6 用户态 | Command Set F |

## Result Block To Paste Into `sign-off-main.md`

```yaml
signed_by: _待填_
signed_at: _待填_
p7_status: completed-closed-as-gated
p8_status: skipped
llm_wiki_diff_summary: _待填_
build_static: _待填_
package_smoke: _待填_
tests: _待填_
metrics: _待填_
mode_smoke: _待填_
provider_smoke: _待填_
notes: _待填_
```

## Failure Routing

| Failure Type | Route |
|--------------|-------|
| build/typecheck | fix as sign-off blocker |
| package-boundary | fix under BR01 guard; do not start BR04 |
| missing package on fresh install | fix release/dependency manifest before sign-off |
| browser UX issue | fix fallback/extension loading only; do not split raw harness package |
| model metadata perf issue | collect metrics; reopen BR03 only if accepted |
| esbuild/build speed concern | record as future BR04; not sign-off blocker unless current build is unusable |
| provider credential missing | document unavailable; not a failure if error is clear |
| characterization missing cassette | regenerate from frozen main or mark accepted gap |
