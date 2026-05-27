---
id: wiki:symbols
title: Exported Symbol Map
sources:
  - llm-wiki/graph.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.351Z
---

# Exported Symbol Map

Exported symbols are extracted from the TypeScript AST. Full symbol lookup lives in `search-index.json` and `site/explorer.html`.

| Source File | Exports | Examples |
| --- | ---: | --- |
| `index.ts` | 296 | `AgentEndEvent`, `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, and 288 more |
| `core/extensions/index.ts` | 133 | `AgentEndEvent`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, `AppAction`, `AppendEntryHandler`, `BashToolCallEvent`, `BashToolResultEvent`, and 125 more |
| `core/extensions/types.ts` | 120 | `AgentEndEvent`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, `AppAction`, `AppendEntryHandler`, `BashToolCallEvent`, `BashToolResultEvent`, and 112 more |
| `packages/mem-core/src/index.ts` | 108 | `AbstractionLevel`, `AlignmentSnapshot`, `BaseMemoryV2`, `EmbeddingConfig`, `EmbeddingFn`, `EmbeddingIndexRecord`, `EmbeddingRef`, `Episode`, and 100 more |
| `packages/tui/src/index.ts` | 89 | `AutocompleteItem`, `AutocompleteProvider`, `Box`, `CURSOR_MARKER`, `CancellableLoader`, `CellDimensions`, `CombinedAutocompleteProvider`, `Component`, and 81 more |
| `core/index.ts` | 77 | `AgentEndEvent`, `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, and 69 more |
| `core/tools/index.ts` | 70 | `BashOperations`, `BashSandboxOptions`, `BashSpawnContext`, `BashSpawnHook`, `BashToolDetails`, `BashToolInput`, `BashToolOptions`, `DEFAULT_MAX_BYTES`, and 62 more |
| `modes/interactive/components/index.ts` | 51 | `ALL_SPRITES`, `ArminComponent`, `AssistantMessageComponent`, `AttachmentsBarComponent`, `BashExecutionComponent`, `BorderedLoader`, `BranchSummaryMessageComponent`, `BuddyPetComponent`, and 43 more |
| `core/runtime/sdk.ts` | 36 | `CreateAgentSessionOptions`, `CreateAgentSessionResult`, `ExtensionAPI`, `ExtensionCommandContext`, `ExtensionContext`, `ExtensionFactory`, `PromptTemplate`, `SDKLogger`, and 28 more |
| `packages/soul-core/src/index.ts` | 36 | `CognitiveStyle`, `DecisionMemory`, `EmotionalState`, `EvolutionTrigger`, `ExpertiseArea`, `FailureMemory`, `InteractionContext`, `LlmFn`, and 28 more |
| `config.ts` | 35 | `APP_NAME`, `CONFIG_DIR_NAME`, `ENV_AGENT_DIR`, `InstallMethod`, `PACKAGE_NAME`, `VERSION`, `detectInstallMethod`, `getAgentDir`, and 27 more |
| `packages/mem-core/src/types.ts` | 34 | `AlignmentSnapshot`, `ComparativeInsight`, `DeveloperPersona`, `EnhancedInsightsReport`, `Episode`, `EventData`, `ExtractedItem`, `ExtractedWork`, and 26 more |
| `packages/ai/src/types.ts` | 31 | `Api`, `AssistantMessage`, `AssistantMessageEvent`, `AssistantMessageEventStream`, `CacheRetention`, `Context`, `ImageContent`, `KnownApi`, and 23 more |
| `extensions/defaults/loop/cron/index.ts` | 29 | `CronScheduler`, `CronSchedulerOptions`, `CronTask`, `CronTaskCreateParams`, `CronTaskCreateResult`, `DEFAULT_RECURRING_MAX_AGE_MS`, `MAX_CRON_TASKS`, `ParsedCron`, and 21 more |
| `core/session/session-manager.ts` | 27 | `BranchSummaryEntry`, `CURRENT_SESSION_VERSION`, `CompactionEntry`, `CustomEntry`, `CustomMessageEntry`, `FileEntry`, `LabelEntry`, `ModelChangeEntry`, and 19 more |
| `packages/mem-core/src/types-v2.ts` | 26 | `AbstractionLevel`, `BaseMemoryV2`, `EmbeddingFn`, `EmbeddingIndexRecord`, `EmbeddingRef`, `EpisodeFacet`, `EpisodeMemory`, `EvidenceRef`, and 18 more |
| `packages/ai/src/utils/oauth/index.ts` | 25 | `anthropicOAuthProvider`, `antigravityOAuthProvider`, `geminiCliOAuthProvider`, `getGitHubCopilotBaseUrl`, `getOAuthApiKey`, `getOAuthProvider`, `getOAuthProviderInfoList`, `getOAuthProviders`, and 17 more |
| `extensions/defaults/team/team-types.ts` | 24 | `AgentLiveView`, `Handoff`, `HarnessFeature`, `HarnessPhase`, `HarnessState`, `LeaderPlan`, `LeaderSubtask`, `PersistedTeammate`, and 16 more |
| `modes/interactive/theme/theme.ts` | 24 | `Theme`, `ThemeBg`, `ThemeColor`, `ThemeInfo`, `getAvailableThemes`, `getAvailableThemesWithPaths`, `getEditorTheme`, `getLanguageFromPath`, and 16 more |
| `packages/tui/src/terminal-image.ts` | 24 | `CellDimensions`, `ImageDimensions`, `ImageProtocol`, `ImageRenderOptions`, `TerminalCapabilities`, `allocateImageId`, `calculateImageRows`, `deleteAllKittyImages`, and 16 more |
| `extensions/defaults/plan/types.ts` | 21 | `DEFAULT_PLAN_CONFIG`, `PLAN_CUSTOM_TYPE`, `PlanApprovalRequest`, `PlanApprovalResponse`, `PlanAttachment`, `PlanAttachmentType`, `PlanFileInfo`, `PlanFileReferenceAttachment`, and 13 more |
| `packages/soul-core/src/types.ts` | 21 | `CognitiveStyle`, `DecisionMemory`, `EmotionalState`, `EvolutionTrigger`, `ExpertiseArea`, `FailureMemory`, `InteractionContext`, `LlmFn`, and 13 more |
| `core/config/settings-manager.ts` | 19 | `AgentLoopFrameworkSetting`, `AgentLoopFrameworkSettingInput`, `BranchSummarySettings`, `CompactionSettings`, `FileSettingsStorage`, `ImageSettings`, `InMemorySettingsStorage`, `MarkdownSettings`, and 11 more |
| `extensions/defaults/plan/plan-file-manager.ts` | 18 | `clearAllPlanSlugs`, `clearPlanSlug`, `copyPlanFile`, `copyPlanFileToNewSlug`, `copyPlanForFork`, `copyPlanForResume`, `generatePlanSlug`, `getPlan`, and 10 more |
| `extensions/defaults/team/team-harness.ts` | 18 | `HarnessExitResult`, `HarnessFeatureList`, `beginHarnessTurn`, `buildCodingPhaseInstructions`, `buildCompletePhaseInstructions`, `buildFixPhaseInstructions`, `buildHarnessInstructions`, `buildInitPhaseInstructions`, and 10 more |
| `packages/mem-core/src/store-v2.ts` | 18 | `NanoMemV2Paths`, `getV2Paths`, `loadV2Episodes`, `loadV2Facets`, `loadV2Links`, `loadV2Meta`, `loadV2Procedural`, `loadV2Semantic`, and 10 more |
| `core/session/compaction/compaction.ts` | 17 | `CompactionDetails`, `CompactionPreparation`, `CompactionResult`, `CompactionSettings`, `ContextUsageEstimate`, `CutPointResult`, `DEFAULT_COMPACTION_SETTINGS`, `calculateContextTokens`, and 9 more |
| `extensions/defaults/debug/collectors.ts` | 17 | `AgentState`, `ConfigInfo`, `DiagnosticData`, `GitInfo`, `ModelInfo`, `PreferencesInfo`, `SessionInfo`, `SystemInfo`, and 9 more |
| `packages/agent-core/src/types.ts` | 17 | `AgentContext`, `AgentEvent`, `AgentLoopConfig`, `AgentLoopFramework`, `AgentLoopFrameworkInput`, `AgentMessage`, `AgentState`, `AgentTool`, and 9 more |
| `extensions/defaults/grub/grub-types.ts` | 15 | `FEATURE_LIST_VERSION`, `FeatureCategory`, `FeatureItem`, `FeatureList`, `GrubControllerState`, `GrubDecision`, `GrubDecisionStatus`, `GrubLocale`, and 7 more |
| `extensions/defaults/loop/cron/cron-tasks.ts` | 15 | `addCronTask`, `addSessionCronTask`, `clearSessionCronTasks`, `deleteCronTask`, `getCronFilePath`, `getCronTask`, `getSessionCronTask`, `getSessionCronTasks`, and 7 more |
| `core/mcp/index.ts` | 14 | `APIKeyGuidance`, `API_KEY_GUIDANCE`, `MCPClient`, `MCPServerConfig`, `MCPTool`, `MCPToolResult`, `createMCPTool`, `formatGuidanceMessage`, and 6 more |
| `core/messages.ts` | 14 | `BRANCH_SUMMARY_PREFIX`, `BRANCH_SUMMARY_SUFFIX`, `BashExecutionMessage`, `BranchSummaryMessage`, `COMPACTION_SUMMARY_PREFIX`, `COMPACTION_SUMMARY_SUFFIX`, `CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT`, `CompactionSummaryMessage`, and 6 more |
| `nanopencil-defaults.ts` | 14 | `DEFAULT_PENCIL_MD`, `NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER`, `NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER`, `NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER`, `NANOPENCIL_ARK_CODING_PROVIDER`, `NANOPENCIL_DEFAULT_MODELS_JSON`, `NANOPENCIL_DEFAULT_PROVIDER`, `NANOPENCIL_MINIMAX_CODING_PROVIDER`, and 6 more |
| `packages/agent-core/src/errors.ts` | 14 | `AgentError`, `ConnectionError`, `ContextOverflowError`, `ExtensionError`, `NetworkError`, `RateLimitError`, `TimeoutError`, `ToolExecutionError`, and 6 more |
| `core/i18n/index.ts` | 13 | `AVAILABLE_LOCALES`, `LOCALE_NAMES`, `Locale`, `Messages`, `SlashCommands`, `Themes`, `TranslationPaths`, `getLocale`, and 5 more |
| `core/runtime/agent-session.ts` | 13 | `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `CycleModelError`, `ExtensionBindings`, `ModelCycleResult`, `ParsedSkillBlock`, and 5 more |
| `modes/index.ts` | 13 | `InteractiveMode`, `InteractiveModeOptions`, `ModelInfo`, `PrintModeOptions`, `RpcClient`, `RpcClientOptions`, `RpcCommand`, `RpcEventListener`, and 5 more |
| `core/persona/persona-manager.ts` | 12 | `PersonaManager`, `getActivePersonaId`, `getPersonaDir`, `getPersonaMcpConfigPath`, `getPersonaMemoryDir`, `getPersonaPencilPath`, `getPersonaSkillsDir`, `getPersonaSoulDir`, and 4 more |
| `extensions/defaults/grub/grub-feature-list.ts` | 12 | `FeatureListDiffError`, `allPassing`, `countPassing`, `createInitialFeatureList`, `defaultFeatureListPath`, `ensureParentDirectory`, `firstPending`, `isFeatureList`, and 4 more |
| `packages/tui/src/tui.ts` | 12 | `CURSOR_MARKER`, `Component`, `Container`, `Focusable`, `OverlayAnchor`, `OverlayHandle`, `OverlayMargin`, `OverlayOptions`, and 4 more |
| `core/custom-providers.ts` | 11 | `CUSTOM_ANTHROPIC_PROVIDER`, `CUSTOM_OPENAI_PROVIDER`, `CustomProtocolProviderId`, `ensureCustomProtocolProvidersInModels`, `getCustomProtocolProviderBaseUrl`, `getCustomProtocolProviderDefinition`, `getCustomProtocolProviderModelName`, `isCustomProtocolProvider`, and 3 more |
| `core/mcp/mcp-config.ts` | 11 | `MCPConfig`, `addMCPServer`, `getMCPConfigPath`, `getMCPServer`, `listEnabledMCPServers`, `listMCPServers`, `loadMCPConfig`, `removeMCPServer`, and 3 more |
| `core/tools/edit-diff.ts` | 11 | `EditDiffError`, `EditDiffResult`, `FuzzyMatchResult`, `computeEditDiff`, `detectLineEnding`, `fuzzyFindText`, `generateDiffString`, `normalizeForFuzzyMatch`, and 3 more |
| `extensions/defaults/team/team-presets.ts` | 11 | `AutoTeamPlan`, `AutoTeamResult`, `PRESETS`, `PresetResult`, `PresetSpec`, `PresetTeammateSpec`, `executeAutoTeam`, `executePreset`, and 3 more |
| `packages/mem-core/src/engine-scoring-v2.ts` | 11 | `V2ScoreBreakdown`, `breakdownEpisodeFacet`, `breakdownEpisodeMemory`, `breakdownProcedural`, `breakdownV2Semantic`, `computeStructuralBoost`, `currentStructuralAnchor`, `scoreEpisodeFacet`, and 3 more |
| `packages/mem-core/src/scoring.ts` | 11 | `ScoreWeights`, `daysSince`, `decay`, `extractTags`, `getInjectionLevel`, `pickTop`, `scoreEntry`, `scoreEpisode`, and 3 more |
| `packages/mem-core/src/store.ts` | 11 | `deriveNameFromContent`, `deriveSummaryFromContent`, `loadEntries`, `loadEpisodes`, `loadMeta`, `loadWork`, `readJson`, `saveEntries`, and 3 more |
| `packages/tui/src/utils.ts` | 11 | `applyBackgroundToLine`, `extractAnsiCode`, `extractSegments`, `getSegmenter`, `isPunctuationChar`, `isWhitespaceChar`, `sliceByColumn`, `sliceWithWidth`, and 3 more |
| `core/model-resolver.ts` | 10 | `InitialModelResult`, `ParsedModelResult`, `ResolveCliModelResult`, `ScopedModel`, `defaultModelPerProvider`, `findInitialModel`, `parseModelPattern`, `resolveCliModel`, and 2 more |
| `core/sub-agent/index.ts` | 10 | `InProcessSubAgentBackend`, `SubAgentBackend`, `SubAgentEvent`, `SubAgentHandle`, `SubAgentResult`, `SubAgentRuntime`, `SubAgentSpec`, `SubprocessBackendOptions`, and 2 more |
| `core/tools/bash.ts` | 10 | `BashOperations`, `BashSandboxOptions`, `BashSpawnContext`, `BashSpawnHook`, `BashToolDetails`, `BashToolInput`, `BashToolOptions`, `bashTool`, and 2 more |
| `extensions/defaults/sal/terrain.ts` | 10 | `CoverageReport`, `TerrainEdge`, `TerrainNode`, `TerrainNodeKind`, `TerrainSnapshot`, `buildTerrainIndex`, `checkDipCoverage`, `isSnapshotStale`, and 2 more |
| `extensions/defaults/security-audit/interface.ts` | 10 | `AuditEvent`, `AuditEventStatus`, `AuditEventType`, `DEFAULT_SECURITY_CONFIG`, `LogQueryOptions`, `SecurityCheckResult`, `SecurityConfig`, `SecurityEngine`, and 2 more |
| `packages/mem-core/src/engine-injection-text.ts` | 10 | `ActiveInjectionData`, `CONVERSATION_PREFERENCE_PATTERNS`, `CueInjectionData`, `InjectedMemoryOrderRecord`, `buildInjectedMemoryOrder`, `buildProgressiveInjectionText`, `isConversationPreference`, `mergeUniqueEntries`, and 2 more |
| `core/extensions/runner.ts` | 9 | `ExtensionErrorListener`, `ExtensionRunner`, `ForkHandler`, `NavigateTreeHandler`, `NewSessionHandler`, `ReloadHandler`, `ShutdownHandler`, `SwitchSessionHandler`, and 1 more |
| `core/session/compaction/branch-summarization.ts` | 9 | `BranchPreparation`, `BranchSummaryDetails`, `BranchSummaryResult`, `CollectEntriesResult`, `FileOperations`, `GenerateBranchSummaryOptions`, `collectEntriesForBranchSummary`, `generateBranchSummary`, and 1 more |
| `core/tools/truncate.ts` | 9 | `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `GREP_MAX_LINE_LENGTH`, `TruncationOptions`, `TruncationResult`, `formatSize`, `truncateHead`, `truncateLine`, and 1 more |
| `extensions/defaults/sal/anchors.ts` | 9 | `AnchorCandidate`, `AnchorResolution`, `AnchorTargetKind`, `LocateActionInput`, `LocateTaskInput`, `StructuralAnchor`, `locateAction`, `locateTask`, and 1 more |
| `packages/mem-core/src/embedding-index.ts` | 9 | `EmbeddingIndexFile`, `EmbeddingSourceItem`, `checksumText`, `cosineSimilarity`, `getEmbeddingIndexPath`, `loadEmbeddingIndex`, `queryEmbeddingIndex`, `saveEmbeddingIndex`, and 1 more |
