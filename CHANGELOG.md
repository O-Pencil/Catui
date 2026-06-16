# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.12] - 2026-06-16

### Added
- feat(update): silent background auto-update every 30 minutes
- feat(prompt): absorb Claude Code system prompt into Catui
- feat(update): auto-download and restart on new version detected
- feat(v1.1.8): session listing API, session_state_changed event, stats getters
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): never crash on an over-width rendered line at narrow widths
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(learning-framework): add reusable "learn-a-codebase" framework + catui course pack
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore: add dev-loop handoff script and update dev-docs
- chore: v1.1.10 — session listing, session_state_changed event, stats getters
- chore(v1.1.10): replace nanoPencil with catui in docs, add dev-loop infra
- chore: bump version to 1.1.9
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.11] - 2026-06-16

### Added
- feat(prompt): absorb Claude Code system prompt into Catui
- feat(update): auto-download and restart on new version detected
- feat(v1.1.8): session listing API, session_state_changed event, stats getters
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore: add dev-loop handoff script and update dev-docs
- chore: v1.1.10 — session listing, session_state_changed event, stats getters
- chore(v1.1.10): replace nanoPencil with catui in docs, add dev-loop infra
- chore: bump version to 1.1.9
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.10] - 2026-06-14

### Added
- feat(v1.1.8): session listing API, session_state_changed event, stats getters
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(v1.1.10): replace nanoPencil with catui in docs, add dev-loop infra
- chore: bump version to 1.1.9
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.10] - 2026-06-14

### Added
- feat(v1.1.8): session listing API, session_state_changed event, stats getters
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore: bump version to 1.1.9
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.9] - 2026-06-14

### Added
- feat(v1.1.8): session listing API, session_state_changed event, stats getters
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.8] - 2026-06-14

### Added
- feat(v1.1.7): expose settings API on AgentSession for GUI consumption
- feat(v1.1.6): align remaining CC tools, session tag API, and new extensions
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(loop): replace "Claude" with generic terms in cron tool descriptions
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.7] - 2026-06-14

### Added
- feat(sdk): expose 42 settings getter/setter methods on AgentSession for GUI consumption
- feat(sdk): add CronCreate/CronDelete/CronList and TeamCreate/TeamDelete tool mappings
- feat(sdk): session tag API (tagSession/getSessionTags)

## [1.1.6] - 2026-06-14

### Added
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.6] - 2026-06-14

### Added
- feat(tools): add CronCreate/CronDelete/CronList to OAuth tool mapping (loop extension already implements)
- feat(tools): add TeamCreate/TeamDelete LLM-callable tools wrapping TeamRuntime
- feat(session): add TagEntry type and tagSession/getSessionTags API
- feat(tools): add NotebookEdit tool for Jupyter notebook cell editing
- feat(tools): add Skill tool for LLM-callable skill invocation
- feat(tools): add KillShell alias and background bash process kill to TaskStop
- feat(tools): enhance TaskOutput to support background bash task output with blocking

## [1.1.5] - 2026-06-14

### Added
- feat(sdk): systemPrompt object format and thinkingBudgets option
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.4] - 2026-06-14

### Added
- feat(sdk): tool parameter field name compatibility and persona injection priority
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.3] - 2026-06-14

### Added
- feat(sdk): sdk:mcp_ready enrichment, parentToolCallId, and new session options
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.2
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.2] - 2026-06-14

### Added
- feat(sdk): streaming tool input, structuredPatch, and sub-agent event details
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.1
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.1] - 2026-06-13

### Added
- feat(sdk): add permissionMode option for plan mode
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.1.0
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [1.1.0] - 2026-06-13

### Added
- feat(sdk): align with anthropic-sdk for GUI consumption
- feat: bundle preset personas, add qwen3.7-plus to dashscope-coding
- feat(tui): replace welcome banner ASCII art
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(tui): restore startup cats banner
- fix(goal): guard debug filesystem writes
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @pencil-agent/protocol (Phase B sample)
- refactor(protocol): rename @pencil-agent/extension-sdk → @pencil-agent/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @pencil-agent/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): bump catui-agent to 1.0.0
- chore(release): publish catui-agent packages
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.3] - 2026-06-13

### Fixed
- fix(goal): guard debug filesystem writes


## [2.0.2] - 2026-06-13

### Added
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(config): mkdir -p before writing models.json (defensive, fresh-install safety)
- fix(interactive): debug logging must never crash on a fresh install (P0, 2.0.0)
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @catui/protocol (Phase B sample)
- refactor(protocol): rename @catui/extension-sdk → @catui/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @catui/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): 2.0.0
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.1] - 2026-06-13

### Added
- feat(sdk): `mcpConfigPath` option — load MCP config from external path (e.g. ~/.claude.json)
- feat(sdk): `additionalSkillPaths` option — extra skill search directories without symlink
- feat(sdk): `additionalAgentDirs` option — extra AGENT.md/CLAUDE.md search directories
- feat(sdk): `debugLevel` option + structured debug events (`session.subscribe` debug channel)
- feat(goal): stronger continuation/completion/blocked audit prompts, higher limits (10/30)
- fix(goal): timer shows sub-second precision (0.1s granularity)
- fix(persona): always set all 4 env vars on persona load, force reload session

### Changed
- goal status bar tick rate: 200ms (was 1000ms)
- continuation limits: 10 consecutive / 30 total (was 5 / 15)

---

## [2.0.0] - 2026-06-12

### Added
- feat(goal): strengthen continuation prompts and raise limits
- feat(p8)!: narrow public SDK surface
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(protocol): re-export extension flag types
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add extension flag contract
- refactor(protocol): add hook event vocabulary
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @catui/protocol (Phase B sample)
- refactor(protocol): rename @catui/extension-sdk → @catui/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(protocol): update README with usage examples and API docs
- docs(p8): record protocol candidate deferrals
- docs(conventions): type/protocol placement rule + rename extension-sdk → @catui/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): 2.0.0-beta.10
- chore(release): 2.0.0-beta.9
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries

## [2.0.0-beta.9] - 2026-06-12

### Added
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @catui/protocol (Phase B sample)
- refactor(protocol): rename @catui/extension-sdk → @catui/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(conventions): type/protocol placement rule + rename extension-sdk → @catui/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.0-beta.8] - 2026-06-12

### Added
- feat(goal): pull-model continuation + clean terminal stop
- feat: extension clearFollowUpQueue API, persona startup env fix, remove streaming preview
- feat(tui): persistent task status panel and streaming output preview
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix: ai subpath aliases, plan shortcut conflict, persona switch without fork
- fix: cat message carousel 3s interval, persona env on startup
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(protocol): add command contract slice
- refactor(protocol): consolidate ExtensionFlag into @catui/protocol (Phase B sample)
- refactor(protocol): rename @catui/extension-sdk → @catui/protocol (Phase B B0)
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs(conventions): type/protocol placement rule + rename extension-sdk → @catui/protocol
- docs(p8): add executable P8 scope — per-symbol export matrix + migration
- docs(p7): close the size line — record BR02 measured/kept-bundled
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(workflow): verify:all rebuilds internal libs before tsc
- chore(release): 2.0.0-beta.8
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.0-beta.8] - 2026-06-11

### Added
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(persona): set NANO_PERSONA_DIR on startup for default persona
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore(release): 2.0.0-beta.7
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.0-beta.7] - 2026-06-11

### Added
- feat(persona): persona system hardening, presence style switching, slash command highlighting
- feat(models): add remote model discovery + fix loader accent bleed
- feat(models): remote model discovery with known-model fallback
- feat(ui): rate-limit cat working message rotation
- feat(ui): TUI debug logging, loader polish, and plan progress panel
- feat(plan): interview phase workflow and config
- feat(grub): blocked signal detection and task state improvements
- feat(models): auto-probe custom provider context window
- feat(tools): find sort by modified time
- feat(tools): grep output modes, multiline, and type filter
- feat(tools): bash background tasks and configurable timeout
- feat(tools): add PDF document support across type system and providers
- feat(ui): add Ctrl+K to reconfigure API key from model selector
- feat(models): add 13 models to Ali Token Plan provider
- feat(sub-agent): wire TUI panel with tree layout and braille spinner
- feat: CachedContainer render cache, notification queue, presence/goal/soul enhancements
- feat(tools): add renderCall/renderResult to task, plan, goal, ask-user-question tools
- feat(link-world): expand MCP bridge — WebFetch, WebSearch, LSP integration
- feat(plan): enhance plan mode — ExitPlanMode tool, workflow prompts, context cleanup
- feat(lsp): add LSP client extension — goToDefinition, findReferences, hover
- feat(insights): add session insights engine with HTML report generation
- feat(ask-user-question): add interactive question dialog extension
- feat(goal): add /goal long-running task extension — controller, store, prompts
- feat(loop): 1:1 port CC cron/loop system — parser, tasks, scheduler, lock, tools
- feat(task): add TaskCreate/Get/Update/List/Stop/Output + ToolSearch extension
- feat(teach): add guided knowledge teaching extension

### Fixed
- fix(ui): shorten cat working messages to single words
- fix(ui): declare missing highlightInput property on CustomEditor
- fix(models): type discovery API response
- fix(goal): update timer format assertions for 0.1s precision
- fix(ui): wire promptForProviderApiKey in ProviderConfigPort
- fix(goal): prevent infinite continuation loop and improve TUI feedback
- fix(sub-agent): break agent-registry import cycle + repair SendMessage tool
- fix(dip): list send-message-tool.ts in core/sub-agent AGENT.md
- fix(sub-agent): improve MCP availability check + add SendMessage tool + custom agent loading
- fix(dip): add missing P3 headers to insights/loop extensions + list file-state-cache
- fix(grub): port auto-sanitize initializer hygiene from main (0eea985)
- fix(release): loosen mem-core extension sdk shim
- fix(release): make mem-core publish build self-contained
- fix(release): require republished mem-core for beta.5
- fix(release): add default exports for bundled internal libs
- fix(release): bundle internal runtime libs for beta.3
- fix(build): resolve extension sdk workspace types

### Changed
- refactor(docs): split shipped user manuals from internal dev docs; scaffold feature-skill manuals
- refactor(tools): improve edit/read/write tools + add file state cache
- refactor(sub-agent): port CC agent architecture — definitions, registry, filtering, safety

### Performance
- perf(build): minify shipped JS per-file (esbuild transform, no bundle) — BR04
- perf(build): strip embedded runtime-lib .d.ts/.map from the published tarball
- perf(startup): load MCP off the critical path + parallel/incremental build:deps

### Documentation
- docs: add design docs for goal, loop refactor, and plan mode
- docs: add CC architecture analysis — agent design, TUI design, goal comparison
- docs: update AGENT.md files and add architecture review notes
- docs(agents): make feature-workflow MANDATORY in root project instructions
- docs(arch-review): archive/triage the review corpus (#4)
- docs(workflow): add layer-placement decision + per-layer MUST/CAN/MUST-NOT
- docs(workflow): graduate feature workflow into canonical .dev-docs/feature-workflow.md
- docs(refactor): summarize outcomes and feature workflow
- docs(signoff): record sign-off + cutover; honestly mark P7/P8 incomplete
- docs(signoff): fill S-1 through S-6 acceptance results
- docs(p8): review sdk surface boundaries
- docs(signoff): add readiness runbook
- docs(p7): close bundle redesign review
- docs(p7): defer esbuild bundling
- docs(p7): gate model metadata chunking
- docs(p7): review browser extension packaging
- docs(p7): review bundle redesign boundary
- docs(ledger): update D5 — fix via publishing first-party packages (beta.2)

### Maintenance
- chore: fix DIP header for discovery-cache test
- chore: fix DIP headers and AGENT.md member lists for new files
- chore(models): add generated known-models metadata
- chore(workflow): add pre-push gate so workflow checks run before code leaves the machine
- chore: remove local review docs from tracking (already in .gitignore)
- chore: register new extensions, update deps, add config module
- chore: remove deprecated interview extension
- chore(dip): remove CLAUDE.md duplicates, keep AGENT.md as canonical P2
- chore(p7): guard package boundaries


## [2.0.0-beta.6] - 2026-06-05

### Fixed
- fix(packaging): `mem-core` publish builds could fail before publish when the local workspace link
  for `@catui/extension-sdk` was absent. `mem-core` now carries a type-only build shim for the
  SDK contract while still declaring `extension-sdk` as its peer dependency; publish `mem-core@1.1.2`
  before this host beta.

## [2.0.0-beta.5] - 2026-06-05

### Fixed
- fix(packaging): beta.4 still loaded the published `@catui/mem-core@1.1.0`, whose npm
  tarball is missing at least `dist/config.js` even though the repository build output contains it.
  `mem-core` must be republished as `1.1.1`, then the host beta depends on `^1.1.1` so extension
  loading resolves to the corrected public package.

## [2.0.0-beta.4] - 2026-06-05

### Fixed
- fix(packaging): beta.3 bundled the private internal runtime libraries, but extension loading still
  failed because the loader resolves aliases through `require.resolve()`. The bundled
  `@catui/ai` package exports now include `default` conditions that point at the ESM entry
  files, allowing both ESM imports and loader resolution to find the same internal package.

## [2.0.0-beta.3] - 2026-06-05

### Fixed
- fix(packaging): beta.2 installed but failed at runtime because compiled host files still import
  private internal libraries by package name (`@catui/ai`, `@catui/agent-core`,
  `@catui/tui`). These are not public runtime dependencies in candidate D; they are now copied
  into `dist/node_modules/@catui/*` during the host build so Node can resolve them from the
  published tarball. Public first-party packages (`extension-sdk`, `mem-core`, `soul-core`) continue
  to resolve from npm.

## [2.0.0-beta.2] - 2026-06-05

### Fixed
- fix(packaging): `npm install` of beta.1 still 404'd on `@catui/soul-core` (and would warn on
  `@catui/extension-sdk` via mem-core's peer). These are first-party packages that simply had
  not been published to npm yet. The complete fix publishes them as the standalone packages they are
  (matching `@catui/mem-core`, already on npm) and restores all three as normal `dependencies`
  of the host — no reference rewrite. Install `beta.2`; `beta.0`/`beta.1` are unusable.
  - Required publish: `@catui/soul-core@0.1.0`, `@catui/extension-sdk@0.1.0`.

## [2.0.0-beta.1] - 2026-06-05

### Fixed
- fix(packaging): `npm install` of the beta failed with a 404 for
  `@catui/extension-sdk`. That package is an internal workspace package used only for
  **types** in the host (`import type` only — erased at runtime) and is not published to npm. It was
  incorrectly listed in `dependencies`, so installs tried to fetch it from the registry. Moved to
  `devDependencies` (the host has no runtime dependency on it). `beta.0` is unusable; install `beta.1`.

## [2.0.0-beta.0] - 2026-06-05

> **Beta of a large internal architecture refactor.** This release decomposes the two biggest
> "god files" (the runtime session manager and the interactive TUI) into focused, single-owner
> modules, and makes startup pay only for what you use. Public SDK API is unchanged; one user-facing
> default changes (browser is now opt-in — see Changed). **Behavior parity has not yet been formally
> validated end-to-end** — please report any regression. Installed only via `npm i catui@beta`.

### Changed
- **Browser automation is now opt-in (behavior change).** The browser harness no longer auto-loads
  by default. A lightweight `/browser` command remains and explains how to enable it. Re-enable the
  full extension with `--extension extensions/builtin/browser` or by adding it to your config
  `extensions:` list. (Privacy/terminal-first charter intact; browser stays a user-initiated capability.)
- refactor(runtime): split the AgentSession god file into model / tool-runtime / session-tree
  controllers behind a stable `AgentSession` facade (public API unchanged).
- refactor(interactive): split `interactive-mode.ts` into 12 single-owner controllers
  (image pipeline, self-update, extension UI hosts, model/auth/tree/settings overlays, slash
  dispatcher, input submit, interrupt, stream render) + a consolidated UI state holder.

### Performance
- perf(startup): CLI cold start is substantially faster — only the selected mode and the
  first-used provider load at boot (interactive TUI and unused provider runtimes are no longer
  eagerly imported on `--print`/`--rpc`/`--list-models`). Measured ~60–75% faster boot on
  `--list-models` versus the pre-refactor entry path.
- perf(ai): provider runtimes load lazily on first use by `model.api`; `stream()` stays a
  synchronous EventStream return and token accounting/model availability are unchanged.

### Added
- feat(ai): explicit `@catui/ai/*` subpath exports (`/types`, `/schema`, `/events`,
  `/models`, `/registry`, `/stream`, `/oauth`) alongside the unchanged root export, for lighter
  type-only and capability-scoped imports.

### Fixed
- fix(packaging): built-in extension runtime assets (including the ~1.6 MB browser harness
  workspace) are now correctly copied into `dist/` and published. A path-alignment regression had
  been silently skipping them, so prior packages could ship an incomplete browser harness.

### Documentation
- docs(arch-review): add `REFACTOR-LEDGER.md` — a living summary of what was designed, solved,
  found, and still open across the refactor.

### Known limitations (beta)
- Full provider behavior smoke matrix, all-mode end-to-end validation, and the cross-branch
  sign-off (functional-parity diff, user-state compatibility) are still pending. Treat this build
  as a functional-test beta, not a stability release.
- Install/package size has not decreased in this beta (browser assets still ship); a follow-up
  slice may move browser to a separate optional package.


## [1.14.6] - 2026-05-28

### Fixed
- fix(agent-core): abort pending follow-up checks
- fix(agent-core): abort pending stop hooks
- fix(agent-core): abort pending initial steering
- fix(agent-core): abort pending request preparation
- fix(agent-core): abort pending stream creation
- fix(agent-core): reject empty stream completions
- fix(agent-core): trust final stream events
- fix(agent-core): recover custom stream failures
- fix(agent-core): abort hung custom streams
- fix(ai): retry stream iterator failures
- fix(ai): abort hung provider streams
- fix(ai): abort retry backoff promptly

### Changed
- refactor(agent-core): centralize aborted loop finalization

### Documentation
- docs(arch-review): align architecture review documents


## [1.14.5] - 2026-05-28

### Added
- feat(status): show loop transition history
- feat(agent-core): record loop transition history
- feat(status): show loop policy in status
- feat(agent-core): report loop policy in results
- feat(cli): expose tool result budget control
- feat(cli): expose recovery loop controls
- feat(print): add loop failure exit policies
- feat(cli): add output budget loop controls
- feat(cli): add loop control flags
- feat(print): expose loop result summaries
- feat(acp): show last loop result in session status
- feat(rpc): support loop policy updates
- feat(runtime): expose loop policy updates
- feat(rpc): expose last loop result in state
- feat(sal): record loop outcome in tool traces
- feat(tui): show last loop result in status
- feat(extensions): expose agent result events
- feat(agent-core): support runtime loop policy updates
- feat(agent-core): report limit transitions
- feat(agent-core): store last agent result
- feat(agent-core): expose loop policy options
- feat(agent-core): summarize standard loop tool batches
- feat(agent-core): bound standard tool result batches
- feat(agent-core): continue standard loop outputs
- feat(agent-core): recover standard loop model errors
- feat(agent-core): emit standard loop result telemetry
- feat(agent-core): add standard stop hook continuations
- feat(agent-core): align standard tool lifecycle
- feat(commands): describe model completions
- feat(commands): describe login completions

### Fixed
- fix(ai): retry empty stream completions
- fix(ai): recover stream factory failures
- fix(ai): honor eventless stream results
- fix(ai): emit retry abort stream errors
- fix(agent-core): finalize stream end results
- fix(agent-core): record standard follow-up transitions
- fix(agent-core): record standard tool-result transitions
- fix(ai): prune empty replay assistant messages
- fix(ai): ignore duplicate replay tool results
- fix(ai): drop orphan replay tool results
- fix(ai): close trailing replay tool calls
- fix(agent-core): close skipped limit tool calls
- fix(agent-core): prune recovered standard result messages
- fix(agent-core): prune recovered streaming result messages
- fix(agent-core): tombstone recovered streaming tool denials
- fix(runtime): prune recoverable retry error tails
- fix(ai): drop interrupted orphan tool results
- fix(print): require continuation transition for joined output
- fix(print): join automatic continuation output
- fix(agent-core): close interrupted tool calls
- fix(agent-core): retain loop transition history in state
- fix(print): emit loop result before error exit
- fix(agent-core): clear stale run results
- fix(tui): stabilize terminal render loop
- fix(commands): match language names
- fix(commands): match mcp server names
- fix(commands): match login provider names

### Documentation
- docs(agent-core): align loop framework capabilities
- docs(arch-review): add Phase 2 synthesis and Phase 3a top-level decisions
- docs(self-awareness): extension telemetry smoke test + operating guide
- docs(diagnosis): SOP v4 — single rolling branch + Review Agent SOP

### Maintenance
- chore(ai): refresh generated model catalog


## [1.14.4] - 2026-05-27

### Added
- feat(commands): describe persona completions
- feat(commands): describe agent loop choices
- feat(commands): clarify builtin argument hints
- feat(runtime): enable default tool result budget
- feat(commands): clarify loop completions
- feat(commands): clarify subagent hints
- feat(agent-core): cap aggregate tool results
- feat(commands): clarify team command hints
- feat(agent-core): strengthen structured adaptive loop
- feat(commands): describe diagnostic completions
- feat(commands): add optional command hints
- feat(commands): clarify interview command labels
- feat(commands): humanize sal command hints
- feat(commands): describe browser link completions
- feat(memory): personalize insights voice and language
- feat(diagnostics): add report issue completions
- feat(recap): add mode completions
- feat(figma): add command completions
- feat(memory): generate sectioned insights report
- feat(plan): add root action completions
- feat(security): add command completions
- feat(grub): add command completions
- feat(commands): pass argument completion context
- feat(core): P3 — ext_hook_events writer + per-hook sampling
- feat(core): P2 — ext_llm_calls writer + caller-context bus (idle-thinking detector)
- feat(core): P1 — ext_command_events writer + invokeCommand chokepoint
- feat(core): extract telemetry base layer (P0 of extension telemetry)
- feat(team): add command completions
- feat(subagent): add command completions
- feat(loop): add scheduler command completions
- feat(commands): restore thinking command

### Fixed
- fix(presence): preserve identity style preferences
- fix(tui): clamp viewport cursor rows
- fix(commands): preserve extension-backed completions
- fix(rpc): share slash command catalog metadata
- fix(commands): align debug and resources discovery

### Documentation
- docs(wiki): restructure as bilingual directory with en/zh-CN pages
- docs(diagnosis): migrate runs out of gitignored docs/issues into tracked .dev-docs/
- docs(diagnosis,arch-review): agent-driven SOP + architecture review handbook

### Maintenance
- chore(ai): refresh generated model catalog


## [1.14.3] - 2026-05-27

### Added
- feat(commands): complete current argument token
- feat(commands): improve command discoverability

### Fixed
- fix(tui): prevent render overflow regressions
- fix(commands): align extension command UX
- fix(debug): scope diagnostic prompt injection
- fix(ai): resolve TS2536 generic index error for TypeScript 5.9

### Changed
- refactor(extensions): split large runtime boundaries

### Maintenance
- chore(ai): refresh generated model catalog
- chore: normalize npm package metadata
- chore(ai): refresh generated model catalog


## [1.14.2] - 2026-05-26

### Added
- feat(discipline): add default workflow skills
- feat(wiki): add human-first llm wiki
- feat(extensions): recap M2 — Free path becomes default, Smart via --smart
- feat(extensions): recap M1 — on-demand ※ recap with cost-aware Smart synthesis
- feat(extensions): add completeSimpleWithUsage for cost-aware LLM calls
- feat: multi-agent infrastructure and auto-migration tool (N1-N12)
- feat: add loop adaptation and token saving
- feat: multi-agent infrastructure and migration tool (N1-N12)
- feat(ai): update generated model definitions and costs
- docs: 多 Agent 核心文档 v2.1 — 修正 callsite 数据 + 新增分工总览 + ws_id URL 归一化

### Fixed
- fix: stabilize extension quality gates
- fix(agent-core): update default model to available gemini-2.5-flash-lite
- fix(test): use non-adaptive sonnet variant for interleaved-thinking test
- fix(test): pass mock ExtensionContext to security-audit tool_call handler
- fix(test): align github-copilot test with current model registry
- fix(cron): unify durable task storage to agentDir instead of cwd
- fix(self-diagnosis): add shell:true to npx spawn so Windows can resolve npx.cmd
- fix(self-diagnosis): use pathToFileURL for cross-platform entry-point check
- fix(self-diagnosis): strip framework noise from output.md, record MCP-on-host gap
- fix(self-diagnosis): land variant via SAL whitelist, drop redundant PATCH, record gaps
- fix(tools): validate bash timeout
- fix(tools): validate search window inputs
- fix(tools): validate read window inputs
- fix(runtime): keep default write tools inside workspace
- fix(security): block dangerous tool calls before execution
- fix(team): use correct agent directory environment variable
- fix(idle-think): default to OFF and reset idle timer after exploration
- fix(workspace): unify browser/link-world workspace to global ~/.nanopencil/
- fix(diagnostics): include package version in issue reports
- fix(update): avoid shell args warning on windows
- fix(team): improve collaboration stream and browser packaging

### Changed
- refactor(grub): harden autonomous task runner
- refactor(interactive): consolidate ExtensionContext for shortcut handlers
- refactor(subagent): type runner model option
- refactor(subagent): use typed context model
- refactor(idle-think): use typed settings access
- refactor(soul): type persisted state hydration
- refactor(soul): type evolution reasoning deltas
- refactor(soul): type personality deltas
- refactor(ai): type aborted retry messages
- refactor(mem): type host extension events
- refactor(ai): type env provider lookup
- refactor(agent-dir): tighten metadata extension state
- refactor(cli): type warning interception
- refactor(agent-core): type proxy tool call state
- refactor(ai): type browser extension detection
- refactor(ai): type validation errors
- refactor(ai): type event stream completion
- refactor(ai): type string enum schema
- refactor(soul): type evolution updates
- refactor(subagent): use session message accessor
- refactor(workspace): type patch diff errors
- refactor(mem): type structural file scoring
- refactor(utils): type logger context
- refactor(session): guard session headers
- refactor(tools): type search tool errors
- refactor(tools): type caught tool errors
- refactor(runtime): type extension completions
- refactor(runtime): share slash command catalog
- refactor(runtime): isolate extension core bindings
- refactor(runtime): isolate default tool wiring

### Performance
- perf(cli,theme): defer main.ts and cli-highlight imports until needed

### Documentation
- docs(charter): note that sync-notification automation is live
- docs(recap): add Recap扩展.md design record (-f past .gitignore)
- docs: charter — make catui the canonical source-of-truth for ecosystem
- docs: propose RemoteToolTransport SDK contract (gateway v0.2 M-tools-2)
- docs: v2.4 — P0.5 与 P1 落地，§10.4 路线表打 ✅、§10.5 补 P1 行为变化
- docs: v2.3 — Agent 三种形态分类（SuperAgent/Derived/Custom）+ P0–P5 演进路线
- docs: add project structure and build optimization plan
- docs: add multi-agent local file system design spec

### Maintenance
- chore(dev-docs): bootstrap maintainer handbook and self-diagnosis scaffold
- chore(dip): verify AGENT maps in CI
- chore: add development and audit scripts
- chore: update .gitignore to exclude .history and .npmrc
- chore: remove legacy memory-experiments directory


## [1.14.1] - 2026-05-23

### Added
- feat(extensions): recap M2 — Free path becomes default, Smart via --smart
- feat(extensions): recap M1 — on-demand ※ recap with cost-aware Smart synthesis
- feat(extensions): add completeSimpleWithUsage for cost-aware LLM calls
- feat: multi-agent infrastructure and auto-migration tool (N1-N12)
- feat: add loop adaptation and token saving
- feat: multi-agent infrastructure and migration tool (N1-N12)
- feat(ai): update generated model definitions and costs
- docs: 多 Agent 核心文档 v2.1 — 修正 callsite 数据 + 新增分工总览 + ws_id URL 归一化

### Fixed
- fix(test): use non-adaptive sonnet variant for interleaved-thinking test
- fix(test): pass mock ExtensionContext to security-audit tool_call handler
- fix(test): align github-copilot test with current model registry
- fix(cron): unify durable task storage to agentDir instead of cwd
- fix(self-diagnosis): add shell:true to npx spawn so Windows can resolve npx.cmd
- fix(self-diagnosis): use pathToFileURL for cross-platform entry-point check
- fix(self-diagnosis): strip framework noise from output.md, record MCP-on-host gap
- fix(self-diagnosis): land variant via SAL whitelist, drop redundant PATCH, record gaps
- fix(tools): validate bash timeout
- fix(tools): validate search window inputs
- fix(tools): validate read window inputs
- fix(runtime): keep default write tools inside workspace
- fix(security): block dangerous tool calls before execution
- fix(team): use correct agent directory environment variable
- fix(idle-think): default to OFF and reset idle timer after exploration
- fix(workspace): unify browser/link-world workspace to global ~/.nanopencil/
- fix(diagnostics): include package version in issue reports
- fix(update): avoid shell args warning on windows
- fix(team): improve collaboration stream and browser packaging

### Changed
- refactor(interactive): consolidate ExtensionContext for shortcut handlers
- refactor(subagent): type runner model option
- refactor(subagent): use typed context model
- refactor(idle-think): use typed settings access
- refactor(soul): type persisted state hydration
- refactor(soul): type evolution reasoning deltas
- refactor(soul): type personality deltas
- refactor(ai): type aborted retry messages
- refactor(mem): type host extension events
- refactor(ai): type env provider lookup
- refactor(agent-dir): tighten metadata extension state
- refactor(cli): type warning interception
- refactor(agent-core): type proxy tool call state
- refactor(ai): type browser extension detection
- refactor(ai): type validation errors
- refactor(ai): type event stream completion
- refactor(ai): type string enum schema
- refactor(soul): type evolution updates
- refactor(subagent): use session message accessor
- refactor(workspace): type patch diff errors
- refactor(mem): type structural file scoring
- refactor(utils): type logger context
- refactor(session): guard session headers
- refactor(tools): type search tool errors
- refactor(tools): type caught tool errors
- refactor(runtime): type extension completions
- refactor(runtime): share slash command catalog
- refactor(runtime): isolate extension core bindings
- refactor(runtime): isolate default tool wiring

### Performance
- perf(cli,theme): defer main.ts and cli-highlight imports until needed

### Documentation
- docs(charter): note that sync-notification automation is live
- docs(recap): add Recap扩展.md design record (-f past .gitignore)
- docs: charter — make catui the canonical source-of-truth for ecosystem
- docs: propose RemoteToolTransport SDK contract (gateway v0.2 M-tools-2)
- docs: v2.4 — P0.5 与 P1 落地，§10.4 路线表打 ✅、§10.5 补 P1 行为变化
- docs: v2.3 — Agent 三种形态分类（SuperAgent/Derived/Custom）+ P0–P5 演进路线
- docs: add project structure and build optimization plan
- docs: add multi-agent local file system design spec

### Maintenance
- chore(dev-docs): bootstrap maintainer handbook and self-diagnosis scaffold
- chore(dip): verify AGENT maps in CI
- chore: add development and audit scripts
- chore: update .gitignore to exclude .history and .npmrc
- chore: remove legacy memory-experiments directory


## [1.14.0] - 2026-05-11

### Added
- **Multi-Agent Infrastructure**: Full support for `--agent <id>` to isolate configurations, sessions, and logs.
- **Auto-Migration Tool**: Automatic, safe migration from legacy `~/.nanopencil` to new `~/.pencils` layout on startup.
- **Agent Metadata**: Added `agent.json` support for rich agent identity management.
- **Isolated Security Audit**: Audit logs are now correctly scoped per-agent.

### Changed
- Rebranded default configuration directory to `~/.pencils/`.
- Enhanced `SessionManager` and `AuthStorage` with full `AgentDirContext` awareness.

### Fixed
- Fixed 401 errors caused by incorrect provider selection after migration.
- Resolved circular dependencies in configuration loading.

## [1.13.15] - 2026-05-07

### Added
- docs: 多 Agent 核心文档 v2.1 — 修正 callsite 数据 + 新增分工总览 + ws_id URL 归一化

### Fixed
- fix(idle-think): default to OFF and reset idle timer after exploration
- fix(workspace): unify browser/link-world workspace to global ~/.nanopencil/
- fix(diagnostics): include package version in issue reports
- fix(update): avoid shell args warning on windows
- fix(team): improve collaboration stream and browser packaging

### Performance
- perf(cli,theme): defer main.ts and cli-highlight imports until needed

### Documentation
- docs: add project structure and build optimization plan
- docs: add multi-agent local file system design spec

### Maintenance
- chore: remove legacy memory-experiments directory


## [1.13.14] - 2026-05-03

### Fixed
- fix(workspace): unify browser/link-world workspace to global ~/.nanopencil/
- fix(diagnostics): include package version in issue reports
- fix(update): avoid shell args warning on windows
- fix(team): improve collaboration stream and browser packaging


## [1.13.13] - 2026-05-02

### Added
- feat(team): add named agent workbench orchestration
- feat(interactive): animate welcome banner
- feat(providers): add Ali Cloud Token Plan team edition
- feat(interview): add grill mode
- feat(interview): add grill mode
- feat(perf): add startup benchmark infrastructure
- feat(link-world): gate web_search/web_fetch on agent-reach capabilities
- feat(extensions): add browser automation and link-world enhancements
- feat(mem-core): unify llm json parsing and throttle diagnostics

### Fixed
- fix(diagnostics): keep memory fallbacks silent
- fix: harden memory and team agent behavior
- fix(diagnostics): keep memory fallbacks silent

### Documentation
- docs: add startup performance optimization plan
- docs(eval): add evaluation framework

### Maintenance
- chore(ai): update generated models
- chore(release): 1.13.12
- chore: ignore project-local .nanopencil workspace
- chore: ignore Python bytecode and __pycache__


## [1.13.12] - 2026-05-02

### Added
- feat(interactive): animate welcome banner
- feat(providers): add Ali Cloud Token Plan team edition
- feat(interview): add grill mode
- feat(interview): add grill mode
- feat(perf): add startup benchmark infrastructure
- feat(link-world): gate web_search/web_fetch on agent-reach capabilities
- feat(extensions): add browser automation and link-world enhancements
- feat(mem-core): unify llm json parsing and throttle diagnostics
- feat(agent-core): add turn and tool-call limits to agent loop
- feat(diagnostics): wire issue auto-upload to shared SAL InsForge instance
- feat(diagnostics): unified reportDiagnostic + isDevRuntime helper
- feat(diagnostics,sal): silent auto-upload + on_conflict upserts
- feat(diagnostics): add extension-owned issue reporting

### Fixed
- fix(diagnostics): keep memory fallbacks silent
- fix: harden memory and team agent behavior
- fix(diagnostics): keep memory fallbacks silent
- fix(team): improve runtime status streaming and dashboard rendering
- fix(soul-core): atomic tmp+rename writes for concurrent SoulStore safety
- fix(soul-core): silence corrupted-JSON load failures via diagnostic bus
- fix(runtime,main): stronger MaxListeners silence + plug sleep() listener leak
- fix(runtime,main): plug abort-listener leak + silence MaxListeners noise
- fix(sdk): forward PencilAgent provider/model into createAgentSession
- fix(soul,diagnostics): silence Soul evolution console flood, gate auto-upload by severity
- fix(mem-core): route fallback noise through diagnostics
- fix(diagnostics): reduce non-fatal background noise

### Documentation
- docs: add startup performance optimization plan
- docs(eval): add evaluation framework

### Maintenance
- chore: ignore project-local .nanopencil workspace
- chore: ignore Python bytecode and __pycache__


## [1.13.11] - 2026-05-01

### Added
- feat(agent-core): add turn and tool-call limits to agent loop
- feat(diagnostics): wire issue auto-upload to shared SAL InsForge instance
- feat(diagnostics): unified reportDiagnostic + isDevRuntime helper
- feat(diagnostics,sal): silent auto-upload + on_conflict upserts
- feat(diagnostics): add extension-owned issue reporting
- feat(idle-think): add idle exploration extension with 3-phase architecture
- feat(team,grub,sub-agent): harness streaming, auto-team, grub locale
- feat(team): harness psyche presets dashboard and subagent hooks
- feat: show session resume hint on exit
- feat: add zai provider support with search and auto thinking level
- feat(sal): add legacy-schema fallback for tool_trace on PGRST204 drift
- feat(sal): add bounded tool trace analytics
- feat(update): add confirmation dialog before auto-update on startup
- feat(sal): avoid blocking startup with async eval maintenance
- feat(sal): add build metadata to eval runs

### Fixed
- fix(team): improve runtime status streaming and dashboard rendering
- fix(soul-core): atomic tmp+rename writes for concurrent SoulStore safety
- fix(soul-core): silence corrupted-JSON load failures via diagnostic bus
- fix(runtime,main): stronger MaxListeners silence + plug sleep() listener leak
- fix(runtime,main): plug abort-listener leak + silence MaxListeners noise
- fix(sdk): forward PencilAgent provider/model into createAgentSession
- fix(soul,diagnostics): silence Soul evolution console flood, gate auto-upload by severity
- fix(mem-core): route fallback noise through diagnostics
- fix(diagnostics): reduce non-fatal background noise
- fix(sal): harden eval reporting and gate ab sidecars
- fix(sal): disable stale cleanup by default

### Changed
- refactor(footer): extract renderContextProgressBar with clamp-safe handling

### Documentation
- docs(sal): sync P2 eval/types.ts description with tool_trace event type

### Maintenance
- chore: update grub state
- chore: update generated model list (kimi-k2.6, gemini context fix)


## [1.13.10] - 2026-04-27

### Added
- feat(diagnostics): wire issue auto-upload to shared SAL InsForge instance
- feat(diagnostics): unified reportDiagnostic + isDevRuntime helper
- feat(diagnostics,sal): silent auto-upload + on_conflict upserts
- feat(diagnostics): add extension-owned issue reporting
- feat(idle-think): add idle exploration extension with 3-phase architecture
- feat(team,grub,sub-agent): harness streaming, auto-team, grub locale
- feat(team): harness psyche presets dashboard and subagent hooks
- feat: show session resume hint on exit
- feat: add zai provider support with search and auto thinking level
- feat(sal): add legacy-schema fallback for tool_trace on PGRST204 drift

### Fixed
- fix(sdk): forward PencilAgent provider/model into createAgentSession
- fix(soul,diagnostics): silence Soul evolution console flood, gate auto-upload by severity
- fix(mem-core): route fallback noise through diagnostics
- fix(diagnostics): reduce non-fatal background noise
- fix(sal): harden eval reporting and gate ab sidecars

### Changed
- refactor(footer): extract renderContextProgressBar with clamp-safe handling

### Documentation
- docs(sal): sync P2 eval/types.ts description with tool_trace event type

### Maintenance
- chore: update grub state
- chore: update generated model list (kimi-k2.6, gemini context fix)


## [1.13.9] - 2026-04-26

### Added
- feat(idle-think): add idle exploration extension with 3-phase architecture
- feat(team,grub,sub-agent): harness streaming, auto-team, grub locale

### Maintenance
- chore: update grub state
- chore: update generated model list (kimi-k2.6, gemini context fix)


## [1.13.8] - 2026-04-26

### Added
- feat(team): harness psyche presets dashboard and subagent hooks
- feat: show session resume hint on exit
- feat: add zai provider support with search and auto thinking level
- feat(sal): add legacy-schema fallback for tool_trace on PGRST204 drift
- feat(sal): add bounded tool trace analytics
- feat(update): add confirmation dialog before auto-update on startup
- feat(sal): avoid blocking startup with async eval maintenance
- feat(sal): add build metadata to eval runs

### Fixed
- fix(sal): harden eval reporting and gate ab sidecars
- fix(sal): disable stale cleanup by default

### Changed
- refactor(footer): extract renderContextProgressBar with clamp-safe handling

### Documentation
- docs(sal): sync P2 eval/types.ts description with tool_trace event type


## [1.13.7] - 2026-04-25

### Added
- feat: add zai provider support with search and auto thinking level
- feat(sal): add legacy-schema fallback for tool_trace on PGRST204 drift
- feat(sal): add bounded tool trace analytics
- feat(update): add confirmation dialog before auto-update on startup
- feat(sal): avoid blocking startup with async eval maintenance
- feat(sal): add build metadata to eval runs
- feat(debug): add /set-locale command
- feat(debug): add /debug preferences command
- feat(grub): feature list, persistence layer, and controller/parser upgrades
- feat(plan): refine exit-plan-mode tool and extension wiring
- feat(interactive): optimistic user chat bubble and working elapsed timer
- feat(extensions): add default debug extension with /debug diagnostics
- feat(docs): add DIP verification script and integrate into P1 CLAUDE.md
- feat(dip): add verification script and strengthen covenant
- feat(tui): weighted fuzzy autocomplete and editor placeholder
- feat(tui): add stall animation and tips to pencil loader
- feat(btw): wire BTW extension into builtin list and loader
- feat(btw): add /btw command for side questions without interrupting main task

### Fixed
- fix(sal): disable stale cleanup by default
- fix(presence): correct memory dir fallback path
- fix(presence): only send opening when idle without pending messages
- fix(loop): persist durable cron task removal to disk
- fix(sal): yield before before_agent_start work and prewarm snapshot
- fix(sal): build terrain index asynchronously for TUI responsiveness
- fix(release): remove tag push from postversion to avoid GitHub rule violations
- fix(release): decouple changelog from prepublishOnly to fix circular release flow
- fix(nanopencil-defaults): skip coding plan prompt only when remote provider has auth
- fix(main): add anthropic-custom and ollama to allowOptionalApiKeyForProvider
- fix(tui): correct tip cooldown calculation
- fix(package-manager): remove duplicate param; improve error logging across codebase
- fix(main): restore accidentally removed imports
- fix: restore chalk import; add missing weightedFuzzyFilter import and type annotation
- fix(settings): use readStorageAsync for plain reads; add clarifying comment
- fix(sal,mem-core): improve structural scoring accuracy and eval data quality
- fix(mem-core): structural boost path matching across absolute/relative formats
- fix(shutdown): ensure session_shutdown fires on all exit paths
- fix: suppress debug output and DEP0190 warning in production

### Changed
- refactor(footer): extract renderContextProgressBar with clamp-safe handling
- refactor(docs): remove [POS] block headers, standardize on P3 CLAUDE.md format
- refactor(plan): make writePlan async with atomic temp-file rename

### Performance
- perf(main): remove unused imports; style placeholder with dim ANSI
- perf(cli): add --version/--help fast path; add startup profiler

### Documentation
- docs(sal): sync P2 eval/types.ts description with tool_trace event type
- docs: polish 1.13.4 changelog and SAL Warp compatibility notes
- docs(extensions): refresh CLAUDE maps for defaults and optional paths
- docs: update CHANGELOG for v1.13.1 and v1.13.2
- docs: enrich P2 CLAUDE.md entries; inject Soul traits into presence prompts
- docs(changelog): update for recent changes
- docs(package-manager): correct JSDoc for npmNeedsUpdate after startup optimization
- docs(sal): add worktree-based experiment evaluation guide
- docs(sal): consolidate outline and prune legacy docs

### Maintenance
- chore(ai): regenerate models catalog


## [1.13.6] - 2026-04-23

### Added
- feat(sal): add bounded tool trace analytics
- feat(update): add confirmation dialog before auto-update on startup
- feat(sal): avoid blocking startup with async eval maintenance
- feat(sal): add build metadata to eval runs
- feat(debug): add /set-locale command
- feat(debug): add /debug preferences command
- feat(grub): feature list, persistence layer, and controller/parser upgrades
- feat(plan): refine exit-plan-mode tool and extension wiring
- feat(interactive): optimistic user chat bubble and working elapsed timer
- feat(extensions): add default debug extension with /debug diagnostics
- feat(docs): add DIP verification script and integrate into P1 CLAUDE.md
- feat(dip): add verification script and strengthen covenant
- feat(tui): weighted fuzzy autocomplete and editor placeholder
- feat(tui): add stall animation and tips to pencil loader
- feat(btw): wire BTW extension into builtin list and loader
- feat(btw): add /btw command for side questions without interrupting main task
- feat(plan): complete plan mode workflow
- feat(plan): add TUI status indicators for plan mode
- feat(plan): add Plan Mode extension for read-only planning
- feat(sal): collect recall anchor eval snapshots
- feat(buddy): increase animation frequency for more visible motion
- feat(buddy): remove name and speech bubble below pet sprite
- feat(models): add qwen3.6-plus to DashScope Coding Plan provider
- feat(sal): streamline eval to run_start/turn_anchor/run_end + /sal:setup command
- feat(sdk): add PencilAgent wrapper + SDKLogger interface + console cleanup
- feat(interactive): add /status command for agent status card
- feat(interactive): buddy beside input, ASCII cats, steadier cursor
- feat: buddy pet system, tools dedup, build config and docs updates
- feat(sal): add run-local experiment reporting
- feat(tui): role labels, message backgrounds, theme schema updates
- feat(core): add typed error hierarchy and streaming retry with backoff
- feat(interactive): suggest vision model variants when images are dropped
- feat(interactive): suggest vision model variants when images are dropped
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(presence): integrate soul personality hints and recent lines history
- feat(extensions): split grub from loop, refactor scheduler
- feat(presence): AI-generated idle nudges and per-turn agent perception
- feat(team): add Phase B AgentTeam extension with persistent teammates
- feat(presence): AI-driven personalized greetings with memory context
- feat(subagent): add isolated workspace review and apply flow
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(sal): disable stale cleanup by default
- fix(presence): correct memory dir fallback path
- fix(presence): only send opening when idle without pending messages
- fix(loop): persist durable cron task removal to disk
- fix(sal): yield before before_agent_start work and prewarm snapshot
- fix(sal): build terrain index asynchronously for TUI responsiveness
- fix(release): remove tag push from postversion to avoid GitHub rule violations
- fix(release): decouple changelog from prepublishOnly to fix circular release flow
- fix(nanopencil-defaults): skip coding plan prompt only when remote provider has auth
- fix(main): add anthropic-custom and ollama to allowOptionalApiKeyForProvider
- fix(tui): correct tip cooldown calculation
- fix(package-manager): remove duplicate param; improve error logging across codebase
- fix(main): restore accidentally removed imports
- fix: restore chalk import; add missing weightedFuzzyFilter import and type annotation
- fix(settings): use readStorageAsync for plain reads; add clarifying comment
- fix(sal,mem-core): improve structural scoring accuracy and eval data quality
- fix(mem-core): structural boost path matching across absolute/relative formats
- fix(shutdown): ensure session_shutdown fires on all exit paths
- fix: suppress debug output and DEP0190 warning in production
- fix(plan): fix TypeScript errors for AgentToolResult details field
- fix(sink): change flush to serial execution and add flushInFlight protection
- fix(mcp): Optimize startup performance by removing built-in MCP from Puppeteer.
- fix(sal): flush print-mode eval uploads
- fix(extensions): prioritize local mem-core source over node_modules to avoid conflicts
- fix(tui): disable Kitty keyboard protocol on Wave Terminal
- fix(presence): clarify that presence messages are NOT generated by main agent
- fix(tui): disable synchronized output on Wave Terminal
- fix(sal): add allowSelfSigned option for private CA endpoints
- fix(sal): adapt eval sink to InsForge PostgREST API (/api/database/records/eval_events)
- fix(sal): surface HTTP errors in eval sink + connectivity probe on /sal:setup
- fix(sal): batch eval events for InsForge, sanitize tool_args, fix credentials reading
- fix(interactive): unblock new users with no API key configured
- fix(sal): add missing eval.ts, make eval opt-in, restore sidecar writes, fix PencilAgent.reset()
- fix(interactive): flush user messages before prompt start
- fix(tui): disable synchronized output on Warp terminal
- fix(tui): revert beautification changes causing display bugs, add rebuild safeguards
- fix(session): persist user-only turns before assistant replies
- fix(retry): reset attempt counter on abort in RetryCoordinator
- fix(extensions): dispose extension runner on session shutdown
- fix(tui): align viewport scroll when chat content grows
- fix(tui): emit UI events before awaiting extension handlers for responsive streaming
- fix(scripts): generate changelog on Windows without head command
- fix(scripts): generate changelog on Windows without head command
- fix(interactive): reset clipboard image sequence counter after sending
- fix(interactive): reset clipboard image sequence counter after sending
- fix(build): correct build:deps order — ai must precede agent-core
- fix(build): correct build:deps order — ai must precede agent-core
- fix(sal): stabilize structural anchor bridge
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager
- fix(presence): pass SoulOptions to SoulManager
- fix(loop): use valid ThemeColor "error" instead of "danger" in renderer
- fix(subagent): normalize Windows paths to forward slashes
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow
- fix(acp): improve zed loop and team progress visibility
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Changed
- refactor(docs): remove [POS] block headers, standardize on P3 CLAUDE.md format
- refactor(plan): make writePlan async with atomic temp-file rename
- refactor(loop): unify /loop to cron scheduler architecture
- refactor(sal): decouple SAL+InsForge via turn-context bus and pluggable eval adapters
- refactor(sal): InsForge-native eval sink with typed table routing
- refactor(runtime): extract RetryCoordinator and add structured logging
- refactor(mem-core): split engine into modules
- refactor(mem-core): split engine into modules
- refactor: unify config paths, env vars, and extension API surface
- refactor: unify config paths, env vars, and extension API surface
- refactor(i18n): translate all Chinese comments and strings to English

### Performance
- perf(main): remove unused imports; style placeholder with dim ANSI
- perf(cli): add --version/--help fast path; add startup profiler

### Documentation
- docs: polish 1.13.4 changelog and SAL Warp compatibility notes
- docs(extensions): refresh CLAUDE maps for defaults and optional paths
- docs: update CHANGELOG for v1.13.1 and v1.13.2
- docs: enrich P2 CLAUDE.md entries; inject Soul traits into presence prompts
- docs(changelog): update for recent changes
- docs(package-manager): correct JSDoc for npmNeedsUpdate after startup optimization
- docs(sal): add worktree-based experiment evaluation guide
- docs(sal): consolidate outline and prune legacy docs
- docs: merge AGENT.md into AGENTS.md, remove duplicate file
- docs(changelog): add release notes for v1.11.41
- docs: attribute repo guidance to @o-pencil-agent; add git msg filter helper
- docs(experiment): add SAL experiment results report
- docs(test): add SAL experiment template
- docs(test): add SAL experiment template
- docs(dip): migrate AGENT.md files to WHO/FROM/TO/HERE format
- docs(dip): migrate CLAUDE.md files to WHO/FROM/TO/HERE format
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs(changelog): add v1.11.39 release notes
- docs(changelog): add v1.11.39 release notes
- docs(memory): add cognitive map and SAL experiment drafts
- docs(memory): add cognitive map and SAL experiment drafts
- docs(dip): add P2 for core/sub-agent and core/workspace; sync extensions/defaults
- docs: update CHANGELOG for 1.11.37
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore(ai): regenerate models catalog
- chore: bump version to 1.12.0 - add Plan Mode extension
- chore(models): add MiniMax-M2.7 and Qwen3.5 Plus models
- chore: update changelog for v1.11.45 release
- chore: update changelog for release
- chore: update gitignore for AI agent configs and fix monorepo build scripts
- chore: gitignore .mcp.json (may contain API keys)
- chore(release): 1.11.44
- chore: changelog 1.11.44, gitignore memory-experiments
- chore(ai): remove canvas devDependency for Windows installs
- chore(release): 1.11.43
- chore(ai): sync generated model metadata after release build
- chore(release): 1.11.41
- chore: add experiment memory data to main branch
- chore(changelog): regenerate before release
- chore(changelog): regenerate before release
- chore: add SAL experiment output files
- chore: add SAL experiment output files
- chore(release): v1.11.39
- chore(release): v1.11.39
- chore(release): v1.11.38
- chore(models): update generated model catalog
- chore: remove old /agent team extension
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17
- chore(release): prepare 1.11.16 changelog
- chore(release): prepare 1.11.15 changelog
- chore(release): publish 1.11.15
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.13.5] - 2026-04-21

### Highlights
- **SAL async mode**: Terrain indexing no longer holds the Node event loop — GPU block terminals (Warp, etc.) render smoothly while SAL builds the index.
- **Debug extension**: New `/debug` command with structured three-layer diagnostics and `/set-locale` for language overrides.

### Added
- **BTW extension** (`/btw`): Ask side questions without interrupting the main task — queues follow-up and resumes after the current task.
- **Tips service**: Rotating productivity tips in the interactive TUI when idle.
- **DIP verification**: `scripts/verify-dip.ts` validates P1/P2/P3 document isomorphism before commits.
- **Startup profiler**: `utils/startup-profiler.ts` measures and logs startup timing for performance tuning.
- **Settings manager**: Full async settings with `readStorageAsync`, file watching, and type-safe schema validation.
- GRUB feature list with persistence layer and controller/parser upgrades.

### Fixed
- **Presence**: Corrected memory directory fallback path; only emit AI opening lines when session is idle.
- **Loop cron**: Durable cron task deletion is now persisted to disk for file-backed tasks.
- **SAL**: `setImmediate` yield before `before_agent_start` work; background snapshot prewarm after extension load.
- **Release**: Removed tag push from `postversion` to avoid GitHub Actions rule violations.

### Changed
- **TUI fuzzy autocomplete**: Weighted scoring prioritizes prefix matches over substring matches.
- **Pencil loader**: Working message timer now shows live elapsed time; optimistic user bubble rendering.

### Documentation
- Refreshed P2 CLAUDE.md maps for `core/`, `extensions/`, `packages/`, and SAL experiment guide.
- Consolidated SAL implementation guide and pruned legacy docs.

### Maintenance
- Regenerated bundled AI model catalog (`packages/ai/src/models.generated.ts`).


## [1.13.4] - 2026-04-20

### Highlights
- **Interactive TUI**: User messages appear in the chat immediately after send (including slash commands like `/plan`); the loading banner shows live elapsed time while the agent runs.
- **SAL and block-style terminals**: SAL terrain indexing no longer holds the Node event loop for long synchronous filesystem walks. This addresses delayed user-bubble rendering in Warp and similar GPU block terminals when SAL is enabled. Use `--nosal` only if you need to disable SAL entirely.

### Added
- GRUB: feature list module, persistence layer, and controller/parser upgrades.
- Plan mode: refined `exit-plan-mode` tool and extension wiring.
- Built-in **debug** extension with `/debug` diagnostics (structured three-layer report).
- Interactive: optimistic user message rendering and working-message timer on the pencil loader.

### Fixed
- **SAL**: async terrain snapshot (`buildTerrainIndex`), async staleness checks, deduplicated concurrent snapshot builds, one `setImmediate` yield at `before_agent_start`, and optional background snapshot prewarm after extension load.
- Presence: only emit AI opening lines when the session is idle with no pending messages (avoids races while the agent is busy).
- Loop cron: persist durable cron task deletion to disk after removing file-backed tasks.

### Documentation
- Refreshed extension CLAUDE maps under `extensions/` and `extensions/defaults/`.

### Maintenance
- Regenerated bundled AI model catalog (`packages/ai/src/models.generated.ts`).


## [1.13.3] - 2026-04-20

### Fixed
- fix(release): decouple changelog from prepublishOnly to fix circular release flow
- fix(nanopencil-defaults): skip coding plan prompt only when remote provider has auth
- fix(main): add anthropic-custom and ollama to allowOptionalApiKeyForProvider

### Documentation
- docs: update CHANGELOG for v1.13.1 and v1.13.2


## [1.13.2] - 2026-04-20

### Added
- feat(dip): add verification script for DIP isomorphism
- feat(dip): sync P2 docs for core/, extensions/, packages/mem-core/

### Fixed
- fix(tips): fix cooldown calculation for slash command hints
- fix(package-manager): add error logging to catch blocks
- fix(agent-session): add logging for silent extension errors
- fix(mem-core): log LLM fallback errors in extraction/consolidation

## [1.13.1] - 2026-04-20

### Added
- feat(btw): add /btw command for quick side questions without interrupting the main task
- feat(tui): weighted fuzzy autocomplete and editor placeholder
- feat(tui): add stall animation and tips to pencil loader
- feat(plan): make writePlan async with atomic temp-file rename

### Fixed
- fix(tips): correct cooldown logic for slash command hints
- fix(settings): use readStorageAsync for plain reads
- fix(sal,mem-core): improve structural scoring accuracy and eval data quality
- fix(shutdown): ensure session_shutdown fires on all exit paths
- fix: suppress debug output and DEP0190 warning in production

### Performance
- perf(cli): add --version/--help fast path; add startup profiler

### Documentation
- docs(sal): consolidate outline and prune legacy docs
- docs(changelog): update for recent changes

## [1.13.0] - 2026-04-17

### Fixed
- fix(shutdown): ensure session_shutdown fires on all exit paths
- fix: suppress debug output and DEP0190 warning in production
- fix(mem-core): structural boost path matching across absolute/relative formats

### Changed
- refactor(loop): unify /loop to cron scheduler architecture

### Documentation
- docs(sal): consolidate outline and prune legacy docs
- docs(sal): add worktree-based experiment evaluation guide

### Maintenance
- fix(sal,mem-core): improve structural scoring accuracy and eval data quality


## [1.12.0] - 2026-04-16

### Added
- feat(plan): add Plan Mode extension for read-only planning
- feat(sal): collect recall anchor eval snapshots
- feat(models): add MiniMax-M2.7 and Qwen3.5 Plus models
- feat(models): add qwen3.6-plus to DashScope Coding Plan provider

### Fixed
- fix(plan): fix TypeScript errors for AgentToolResult details field
- fix(sink): change flush to serial execution and add flushInFlight protection
- fix(mcp): optimize startup performance by removing built-in MCP from Puppeteer
- fix(sal): flush print-mode eval uploads
- fix(extensions): prioritize local mem-core source over node_modules to avoid conflicts
- fix(tui): disable Kitty keyboard protocol on Wave Terminal
- fix(presence): clarify that presence messages are NOT generated by main agent
- fix(tui): disable synchronized output on Wave Terminal

### Changed
- refactor(sal): decouple SAL+InsForge via turn-context bus and pluggable eval adapters
- refactor(sal): InsForge-native eval sink with typed table routing

### Documentation
- docs: merge AGENT.md into AGENTS.md, remove duplicate file

### Maintenance
- chore: update gitignore for AI agent configs and fix monorepo build scripts
- chore: gitignore .mcp.json (may contain API keys)


## [1.11.44] - 2026-04-16

### Added
- feat(sal): streamline eval to run_start/turn_anchor/run_end + /sal:setup command
- feat(sdk): add PencilAgent wrapper + SDKLogger interface + console cleanup
- feat(interactive): add /status command for agent status card

### Fixed
- fix(sal): add allowSelfSigned option for private CA endpoints
- fix(sal): adapt eval sink to InsForge PostgREST API (/api/database/records/eval_events)
- fix(sal): surface HTTP errors in eval sink + connectivity probe on /sal:setup
- fix(sal): batch eval events for InsForge, sanitize tool_args, fix credentials reading
- fix(interactive): unblock new users with no API key configured
- fix(sal): add missing eval.ts, make eval opt-in, restore sidecar writes, fix PencilAgent.reset()
- fix(interactive): flush user messages before prompt start

### Changed
- refactor(sal): decouple SAL+InsForge via turn-context bus and pluggable eval adapters
- refactor(sal): InsForge-native eval sink with typed table routing

### Documentation
- docs: merge AGENT.md into AGENTS.md, remove duplicate file

### Maintenance
- chore: update changelog for release
- chore: update gitignore for AI agent configs and fix monorepo build scripts
- chore: gitignore .mcp.json (may contain API keys)


## [1.11.44] - 2026-04-16

### Fixed
- fix(tui): disable synchronized output on Warp terminal
- fix(tui): revert beautification changes causing display bugs, add rebuild safeguards

### Maintenance
- chore(ai): remove canvas devDependency for Windows installs
- chore(release): 1.11.43


## [1.11.42] - 2026-04-12

### Fixed
- fix(session): persist user-only turns before any assistant reply so TUI rebuilds and packaged releases keep the latest user message visible

## [1.11.41] - 2026-04-12

### Added
- feat(interactive): buddy beside input, ASCII cats, steadier cursor
- feat: buddy pet system, tools dedup, build config and docs updates
- feat(sal): add run-local experiment reporting
- feat(tui): role labels, message backgrounds, theme schema updates
- feat(core): add typed error hierarchy and streaming retry with backoff
- feat(interactive): suggest vision model variants when images are dropped
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(presence): integrate soul personality hints and recent lines history
- feat(extensions): split grub from loop, refactor scheduler
- feat(presence): AI-generated idle nudges and per-turn agent perception
- feat(team): add Phase B AgentTeam extension with persistent teammates
- feat(presence): AI-driven personalized greetings with memory context
- feat(subagent): add isolated workspace review and apply flow
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(retry): reset attempt counter on abort in RetryCoordinator
- fix(extensions): dispose extension runner on session shutdown
- fix(tui): align viewport scroll when chat content grows
- fix(tui): emit UI events before awaiting extension handlers for responsive streaming
- fix(scripts): generate changelog on Windows without head command
- fix(interactive): reset clipboard image sequence counter after sending
- fix(build): correct build:deps order — ai must precede agent-core
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager
- fix(loop): use valid ThemeColor "error" instead of "danger" in renderer
- fix(subagent): normalize Windows paths to forward slashes
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow
- fix(acp): improve zed loop and team progress visibility
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Changed
- refactor(runtime): extract RetryCoordinator and add structured logging
- refactor(mem-core): split engine into modules
- refactor: unify config paths, env vars, and extension API surface
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs: attribute repo guidance to @o-pencil-agent; add git msg filter helper
- docs(experiment): add SAL experiment results report
- docs(test): add SAL experiment template
- docs(dip): migrate AGENT.md files to WHO/FROM/TO/HERE format
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs(changelog): add v1.11.39 release notes
- docs(memory): add cognitive map and SAL experiment drafts
- docs(dip): add P2 for core/sub-agent and core/workspace; sync extensions/defaults
- docs: update CHANGELOG for 1.11.37
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore: add experiment memory data to main branch
- chore(changelog): regenerate before release
- chore: add SAL experiment output files
- chore(release): v1.11.39
- chore(release): v1.11.38
- chore(models): update generated model catalog
- chore: remove old /agent team extension
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17
- chore(release): prepare 1.11.16 changelog
- chore(release): prepare 1.11.15 changelog
- chore(release): publish 1.11.15
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.39] - 2026-04-11

### Added
- feat(interactive): suggest vision model variants when images are dropped
- feat(sal): implement SAL extension with default-on structural anchor localization

### Fixed
- fix(interactive): reset clipboard image sequence counter after sending
- fix(build): correct build:deps order — ai must precede agent-core
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager

### Changed
- refactor(mem-core): split engine into modules
- refactor: unify config paths, env vars, and extension API surface

### Documentation
- docs(test): add SAL experiment template
- docs(dip): migrate AGENT.md files to WHO/FROM/TO/HERE format
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs(changelog): add v1.11.39 release notes
- docs(memory): add cognitive map and SAL experiment drafts

### Maintenance
- chore(changelog): regenerate before release
- chore: add SAL experiment output files
- chore(release): v1.11.39


## [1.11.39] - 2026-04-11

### Added
- feat(interactive): suggest vision model variants when images are dropped
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(presence): integrate soul personality hints and recent lines history
- feat(extensions): split grub from loop, refactor scheduler
- feat(presence): AI-generated idle nudges and per-turn agent perception
- feat(team): add Phase B AgentTeam extension with persistent teammates
- feat(presence): AI-driven personalized greetings with memory context
- feat(subagent): add isolated workspace review and apply flow
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(interactive): reset clipboard image sequence counter after sending
- fix(build): correct build:deps order — ai must precede agent-core
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager
- fix(loop): use valid ThemeColor "error" instead of "danger" in renderer
- fix(subagent): normalize Windows paths to forward slashes
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow
- fix(acp): improve zed loop and team progress visibility
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Changed
- refactor(mem-core): split engine into modules
- refactor: unify config paths, env vars, and extension API surface
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs(test): add SAL experiment template
- docs(dip): migrate AGENT.md files to WHO/FROM/TO/HERE format
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs(changelog): add v1.11.39 release notes
- docs(memory): add cognitive map and SAL experiment drafts
- docs(dip): add P2 for core/sub-agent and core/workspace; sync extensions/defaults
- docs: update CHANGELOG for 1.11.37
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore(changelog): regenerate before release
- chore: add SAL experiment output files
- chore(release): v1.11.39
- chore(release): v1.11.38
- chore(models): update generated model catalog
- chore: remove old /agent team extension
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17
- chore(release): prepare 1.11.16 changelog
- chore(release): prepare 1.11.15 changelog
- chore(release): publish 1.11.15
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.39] - 2026-04-11

### Added
- feat(interactive): suggest vision model variants when images are dropped
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(presence): integrate soul personality hints and recent lines history
- feat(extensions): split grub from loop, refactor scheduler
- feat(presence): AI-generated idle nudges and per-turn agent perception
- feat(team): add Phase B AgentTeam extension with persistent teammates
- feat(presence): AI-driven personalized greetings with memory context
- feat(subagent): add isolated workspace review and apply flow
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(interactive): reset clipboard image sequence counter after sending
- fix(build): correct build:deps order — ai must precede agent-core
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager
- fix(loop): use valid ThemeColor "error" instead of "danger" in renderer
- fix(subagent): normalize Windows paths to forward slashes
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow
- fix(acp): improve zed loop and team progress visibility
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Changed
- refactor(mem-core): split engine into modules
- refactor: unify config paths, env vars, and extension API surface
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs(test): add SAL experiment template
- docs(dip): migrate AGENT.md files to WHO/FROM/TO/HERE format
- docs: add P3 protocol headers to 27 files - SubAgent, Team, workspace, security-audit, soul, simplify extensions - packages ai, tui, mem-core key source files - test utilities for agent-core and ai packages
- docs(changelog): add v1.11.39 release notes
- docs(memory): add cognitive map and SAL experiment drafts
- docs(dip): add P2 for core/sub-agent and core/workspace; sync extensions/defaults
- docs: update CHANGELOG for 1.11.37
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore: add SAL experiment output files
- chore(release): v1.11.39
- chore(release): v1.11.38
- chore(models): update generated model catalog
- chore: remove old /agent team extension
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17
- chore(release): prepare 1.11.16 changelog
- chore(release): prepare 1.11.15 changelog
- chore(release): publish 1.11.15
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.39] - 2026-04-10

### Added
- feat(sal): implement SAL extension with default-on structural anchor localization
- feat(presence): integrate soul personality hints and recent lines history
- feat(extensions): split grub from loop, refactor scheduler
- feat(presence): AI-generated idle nudges and per-turn agent perception
- feat(team): add Phase B AgentTeam extension with persistent teammates
- feat(presence): AI-driven personalized greetings with memory context
- feat(subagent): add isolated workspace review and apply flow
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(sal): stabilize structural anchor bridge
- fix(build): add path aliases for mem-core and soul-core
- fix(team): complete AgentTeam Phase B runtime gaps
- fix(update): add shell:true and env for Windows spawn
- fix(presence): pass SoulOptions to SoulManager
- fix(loop): use valid ThemeColor "error" instead of "danger" in renderer
- fix(subagent): normalize Windows paths to forward slashes
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Changed
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs(memory): add cognitive map and SAL experiment drafts
- docs(dip): add P2 for core/sub-agent and core/workspace; sync extensions/defaults
- docs: update CHANGELOG for 1.11.37
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore(release): v1.11.39
- chore(release): v1.11.38
- chore(models): update generated model catalog
- chore: remove old /agent team extension
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.37] - 2026-04-06

### Added
- feat(update): add /reinstall command and force update flag
- feat(subagent): add SubAgent runtime and /subagent command
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration

### Fixed
- fix(loop): update duration parsing and help messages
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models

### Changed
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs: update CHANGELOG for 1.11.36
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header

### Maintenance
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31


## [1.11.36] - 2026-04-06

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration

### Fixed
- fix(loop): defer scheduler ticker until session_start
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models

### Changed
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs: update CHANGELOG for 1.11.35
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header

### Maintenance
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31


## [1.11.35] - 2026-04-06

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration

### Fixed
- fix(build): bundle zod for global install; workspace tsc; soul empty JSON
- fix(utils): improve clipboard timeout and image resize safety
- fix(interactive): improve clipboard and attachment error handling
- fix(clipboard): add missing @mariozechner/clipboard dependency
- fix(team): resolve theme color error and abort listener leak
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models

### Changed
- refactor(i18n): translate all Chinese comments and strings to English

### Documentation
- docs(dip): complete DIP protocol compliance for all source files
- docs(team): restructure SubAgent and AgentTeam as two-phase plan
- docs(team): add agent team refactor plan
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header

### Maintenance
- chore(release): 1.11.35
- chore(ai): regenerate models.generated.ts after build
- chore: merge origin/main into main
- chore: merge origin/main into main
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.33
- chore(release): 1.11.32
- chore(release): 1.11.31


## [1.11.34] - 2026-04-04

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.34] - 2026-04-04

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.34] - 2026-04-04

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.34] - 2026-04-04

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore: release v1.11.34
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.32] - 2026-04-04

### Added
- feat(ai): add MiniMax thinking tag support
- feat(model): improve OAuth token handling in model switching
- feat(debug): export debug logger from core module
- feat(debug): add comprehensive debug logging system for AI providers
- feat(interactive-mode): enhance update workflow with interactive options
- feat(model-selector): add Ctrl+N to append OpenRouter model by id
- feat(interactive): enhance custom editor and mode orchestration
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(debug-logger): enable late environment variable detection
- fix(model-cycling): improve OAuth error handling with typed errors
- fix(interactive-mode): improve update system reliability
- fix(nanopencil): correct MiniMax API endpoint from /anthropic to /v1
- fix(build): bundle zod to dist/node_modules for peerDependency resolution
- fix(interactive-mode): replace npm update with npm install in version check prompt
- fix(tui): show NanoMem command notifications
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore: run changelog before build in prepublishOnly
- chore(release): 1.11.32
- chore(release): 1.11.31
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.32] - 2026-04-04

### Fixed
- fix(ai): avoid InvalidCharacterError when OAuth client placeholders are not base64
- fix(nanopencil): OpenRouter in /login and slim built-in OpenRouter models

### Documentation
- docs: clarify build order; fix oauth client id decode; tidy tsconfig and vitest header

### Maintenance
- chore(release): 1.11.31


## [1.11.31] - 2026-04-04

### Added
- feat(auth): expose openrouter in login selector
- feat(presence): add gentle proactive chat extension
- feat(mem-core): retain superseded procedural rows on merge
- feat(interview): synchronous before_agent_start hook and heuristics
- feat(mem-core): release v1.1.0
- feat(mem-core): add semantic recall and reconsolidation loop
- feat(i18n): add internationalization support (EN/ZH)
- feat(mem-core): add v2 episodic and procedural memory bridge
- feat(dream): add abortable consolidation and auto-dream gating

### Fixed
- fix(nanopencil): OpenRouter 在 /login 与精简内置模型列表
- fix(memory): verify insights and startup presence behavior
- fix(auth): preserve provider api keys in config flows
- fix(presence): wait for ui readiness before greeting
- fix(tui): stabilize startup presence and user echo
- fix(memory): prioritize conversation preferences in recall
- fix(presence): show startup greeting after UI init
- fix(memory): shift runtime recall toward V2
- fix(memory): back up legacy data before maintenance
- fix(memory): stabilize recall and startup maintenance
- fix(release): rebuild bundled packages before publish
- fix(ci): add workspaces config for npm workspace commands
- fix(tui): prevent duplicate Working messages in PencilLoader
- fix(interview): stabilize trigger and clarification flow

### Documentation
- docs(agent): expand AGENT.md with cognitive architecture and quality metrics
- docs(dip): add P3 file headers and layered AGENT.md navigation

### Maintenance
- chore(ai): update model definitions
- chore(release): publish v1.11.18
- chore(release): v1.11.17


## [1.11.15] - 2026-03-30

### Added
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(acp): improve zed loop and team progress visibility
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Documentation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore(release): prepare 1.11.15 changelog
- chore(release): publish 1.11.15
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.15] - 2026-03-31

### Added
- feat(acp): improve zed agent parity
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Documentation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore(release): prepare 1.11.14 changelog
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.13] - 2026-03-29

### Added
- feat(figma): improve remote MCP authentication flow
- feat(agent): hide internal traces and improve time grounding
- feat(mem): add graph-driven memory governance
- feat(team): add multi-agent team orchestration extension
- feat(providers): support custom protocol endpoints
- feat(loop): replace timer loop with autonomous task loop

### Fixed
- fix(mcp): load runtime config from the active MCP path
- fix(interactive): harden extension prompt focus flow
- fix(runtime): tighten workspace handling and startup prompts @o-pencil-agent
- fix(runtime): improve loop recovery and insights reporting
- fix(deps): add zod runtime dependency
- fix(ux): improve custom provider messaging
- fix(providers): reopen and refresh custom provider edits
- fix(providers): streamline custom provider setup
- fix: extract clipboard image data before sending to model

### Documentation
- docs(prompt): refine project assistant charter @o-pencil-agent
- docs(agents): require English for code strings and commits

### Maintenance
- chore(release): prepare 1.11.13 changelog
- chore(release): publish 1.11.12
- chore(release): prepare 1.11.12 changelog
- chore(release): publish 1.11.11
- chore(release): publish 1.11.10
- chore(release): publish 1.11.8
- chore(release): publish 1.11.6
- chore(release): publish 1.11.5


## [1.11.13] - 2026-03-30

### Added
- feat(figma): add standalone Figma MCP OAuth groundwork and built-in Figma setup guidance

### Fixed
- fix(mcp): support streamable HTTP event-stream responses for remote MCP servers
- fix(mcp): allow HTTP MCP tools to execute through the catui MCP client
- fix(figma): make remote Figma MCP usable through built-in presets and authenticated tool discovery

## [1.11.12] - 2026-03-29

### Fixed
- Hardened interactive extension prompt focus handling so interview selectors, extension inputs, and multiline editors recover focus more reliably.
- Prevented stale prompt abort/cancel callbacks from dismissing a newer prompt, reducing the risk of blocked input during long-running or multi-step interactions.
- Restored editor focus more consistently around agent start/end transitions so users can keep typing while execution continues.


## [1.11.11] - 2026-03-29

### Added
- Added separate switches to hide working traces and NanoMem traces by default, making chat responses feel more natural.
- Added a built-in `time` tool so the agent can confirm the real current system time for time-sensitive questions.

### Changed
- Refresh the system prompt timestamp on every turn instead of relying on the session startup time.
- Include real system time context in NanoMem transcript extraction and store episode start/end time metadata for longer-term temporal recall.


## [1.11.10] - 2026-03-29

### Added
- **NanoMem memory governance**
  - Added key event memory, progressive graph context, and relation-aware recall
  - Added current state signals to separate short-term state from stable identity
  - Added alignment snapshot, conflict detection, and review tooling
  - Added memory editing and conflict resolution commands/tools

### Changed
- **NanoMem retrieval and forgetting**
  - Prioritize core memory and key events in progressive disclosure
  - Strengthen graph edges on successful recall and decay weak links over time
  - Let low-signal ambient and situational memory fade faster

### Fixed
- Reduced memory drift caused by temporary mood or short-lived context
- Reduced duplicate cue/context injection by de-duplicating graph neighbors and cue memories

---

## [1.11.2] - 2026-03-19

### Added
- **Interview 扩展优化**
  - 降低 Interview 触发频率，只在模糊需求或短文本时触发
  - 添加 `NANOPENCIL_JUST_SWITCHED_PERSONA` 环境变量，人格切换后跳过 interview
  - 添加 Interview 过程可视化（状态栏和通知）
- **人格包一键切换**: 支持在同一运行环境下按角色隔离 Pencil/Soul/NanoMEM/Skills/MCP 并通过 reload 即时生效

### Fixed
- 修复 /persona 命令在混合消息中无法识别的问题
- 修复版本比较逻辑导致低版本误报更新提示

---

## [1.11.1] - 2026-03-11

### Added
- **Interview 扩展**: 需求澄清扩展，类似 Cursor/Claude Interview，通过交互式问答帮助用户明确需求

### Fixed
- 修复 interview 扩展类型错误
- 更新模型配置

---

## [1.11.0] - 2026-03-10

### Added
- **架构重构**
  - 抽取 AgentSession 协调器，职责更清晰
  - system-prompt 动态化
  - MCP 抽象化为扩展 + ToolSource 接口

### Changed
- **目录重构**
  - `core/` 重构为子目录结构
  - `extensions/` 拆分为 `defaults/` 和 `optional/`
  - `nano-mem` -> `mem-core`, `soul` -> `soul-core`
  - `utils` 目录归类

### Added
- **NanoMem 新功能**
  - 新增 namespaced tools 和 priority 系统
  - 新增 human-insights 模块
  - 新增 generateEnhancedInsights 方法
  - 新增大白话洞察类型和 Prompt

---

## [1.10.7] - 2026-02-28

### Added
- 优化记忆系统提示词，使其更自然类人
- 添加对百度千帆和火山方舟 Coding Plan 的支持
- link-world 扩展支持自动检测并加载 internet-search skill

---

## [1.10.6] - 2026-02-20

### Added
- 添加 MiniMax 和智谱 Coding Plan 支持

---

## [1.10.5] - 2026-02-15

### Added
- 安全审计扩展添加拦截模式 (strict)

---

## [1.10.4] - 2026-02-10

### Fixed
- 将 security-audit 添加到内置扩展加载列表

---

## [1.10.3] - 2026-02-05

### Added
- Security Audit Extension 安全审计扩展

---

## [1.10.2] - 2026-01-28

### Added
- 更新模型选择器以支持无认证模型和 API 密钥提示
- 优化 context 使用显示和颜色逻辑

---

## [1.10.1] - 2026-01-20

### Fixed
- 修复构建脚本和 skill 目录结构

---

## [1.10.0] - 2026-01-15

### Added
- 统一 Soul 包并迁移为扩展

---

*Changelog generated from commit history. For older releases, please refer to git history.*
