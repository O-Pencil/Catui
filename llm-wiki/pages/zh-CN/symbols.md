---
id: wiki:symbols-zh
title: 导出符号地图
sources:
  - llm-wiki/graph.json
generatedFromGraphHash: 67fdf30e687528e70baefc61cc604eb1b059c261dba1a5780da081c3af5a82bb
generatedAt: 2026-05-26T16:35:12.351Z
---

# 导出符号地图

导出符号从 TypeScript AST 中提取。完整的符号查找位于 `search-index.json` 和 `site/explorer.html` 中。

| 源文件 | 导出数 | 示例 |
| --- | ---: | --- |
| `index.ts` | 296 | `AgentEndEvent`, `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback` 等 288 个 |
| `core/extensions/index.ts` | 133 | `AgentEndEvent`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, `AppAction`, `AppendEntryHandler`, `BashToolCallEvent`, `BashToolResultEvent` 等 125 个 |
| `core/extensions/types.ts` | 120 | `AgentEndEvent`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback`, `AppAction`, `AppendEntryHandler`, `BashToolCallEvent`, `BashToolResultEvent` 等 112 个 |
| `packages/mem-core/src/index.ts` | 108 | `AbstractionLevel`, `AlignmentSnapshot`, `BaseMemoryV2`, `EmbeddingConfig`, `EmbeddingFn`, `EmbeddingIndexRecord`, `EmbeddingRef`, `Episode` 等 100 个 |
| `packages/tui/src/index.ts` | 89 | `AutocompleteItem`, `AutocompleteProvider`, `Box`, `CURSOR_MARKER`, `CancellableLoader`, `CellDimensions`, `CombinedAutocompleteProvider`, `Component` 等 81 个 |
| `core/index.ts` | 77 | `AgentEndEvent`, `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `AgentStartEvent`, `AgentToolResult`, `AgentToolUpdateCallback` 等 69 个 |
| `core/tools/index.ts` | 70 | `BashOperations`, `BashSandboxOptions`, `BashSpawnContext`, `BashSpawnHook`, `BashToolDetails`, `BashToolInput`, `BashToolOptions`, `DEFAULT_MAX_BYTES` 等 62 个 |
| `modes/interactive/components/index.ts` | 51 | `ALL_SPRITES`, `ArminComponent`, `AssistantMessageComponent`, `AttachmentsBarComponent`, `BashExecutionComponent`, `BorderedLoader`, `BranchSummaryMessageComponent`, `BuddyPetComponent` 等 43 个 |
| `core/runtime/sdk.ts` | 36 | `CreateAgentSessionOptions`, `CreateAgentSessionResult`, `ExtensionAPI`, `ExtensionCommandContext`, `ExtensionContext`, `ExtensionFactory`, `PromptTemplate`, `SDKLogger` 等 28 个 |
| `packages/soul-core/src/index.ts` | 36 | `CognitiveStyle`, `DecisionMemory`, `EmotionalState`, `EvolutionTrigger`, `ExpertiseArea`, `FailureMemory`, `InteractionContext`, `LlmFn` 等 28 个 |
| `config.ts` | 35 | `APP_NAME`, `CONFIG_DIR_NAME`, `ENV_AGENT_DIR`, `InstallMethod`, `PACKAGE_NAME`, `VERSION`, `detectInstallMethod`, `getAgentDir` 等 27 个 |
| `packages/mem-core/src/types.ts` | 34 | `AlignmentSnapshot`, `ComparativeInsight`, `DeveloperPersona`, `EnhancedInsightsReport`, `Episode`, `EventData`, `ExtractedItem`, `ExtractedWork` 等 26 个 |
| `packages/ai/src/types.ts` | 31 | `Api`, `AssistantMessage`, `AssistantMessageEvent`, `AssistantMessageEventStream`, `CacheRetention`, `Context`, `ImageContent`, `KnownApi` 等 23 个 |
| `extensions/defaults/loop/cron/index.ts` | 29 | `CronScheduler`, `CronSchedulerOptions`, `CronTask`, `CronTaskCreateParams`, `CronTaskCreateResult`, `DEFAULT_RECURRING_MAX_AGE_MS`, `MAX_CRON_TASKS`, `ParsedCron` 等 21 个 |
| `core/session/session-manager.ts` | 27 | `BranchSummaryEntry`, `CURRENT_SESSION_VERSION`, `CompactionEntry`, `CustomEntry`, `CustomMessageEntry`, `FileEntry`, `LabelEntry`, `ModelChangeEntry` 等 19 个 |
| `packages/mem-core/src/types-v2.ts` | 26 | `AbstractionLevel`, `BaseMemoryV2`, `EmbeddingFn`, `EmbeddingIndexRecord`, `EmbeddingRef`, `EpisodeFacet`, `EpisodeMemory`, `EvidenceRef` 等 18 个 |
| `packages/ai/src/utils/oauth/index.ts` | 25 | `anthropicOAuthProvider`, `antigravityOAuthProvider`, `geminiCliOAuthProvider`, `getGitHubCopilotBaseUrl`, `getOAuthApiKey`, `getOAuthProvider`, `getOAuthProviderInfoList`, `getOAuthProviders` 等 17 个 |
| `extensions/defaults/team/team-types.ts` | 24 | `AgentLiveView`, `Handoff`, `HarnessFeature`, `HarnessPhase`, `HarnessState`, `LeaderPlan`, `LeaderSubtask`, `PersistedTeammate` 等 16 个 |
| `modes/interactive/theme/theme.ts` | 24 | `Theme`, `ThemeBg`, `ThemeColor`, `ThemeInfo`, `getAvailableThemes`, `getAvailableThemesWithPaths`, `getEditorTheme`, `getLanguageFromPath` 等 16 个 |
| `packages/tui/src/terminal-image.ts` | 24 | `CellDimensions`, `ImageDimensions`, `ImageProtocol`, `ImageRenderOptions`, `TerminalCapabilities`, `allocateImageId`, `calculateImageRows`, `deleteAllKittyImages` 等 16 个 |
| `extensions/defaults/plan/types.ts` | 21 | `DEFAULT_PLAN_CONFIG`, `PLAN_CUSTOM_TYPE`, `PlanApprovalRequest`, `PlanApprovalResponse`, `PlanAttachment`, `PlanAttachmentType`, `PlanFileInfo`, `PlanFileReferenceAttachment` 等 13 个 |
| `packages/soul-core/src/types.ts` | 21 | `CognitiveStyle`, `DecisionMemory`, `EmotionalState`, `EvolutionTrigger`, `ExpertiseArea`, `FailureMemory`, `InteractionContext`, `LlmFn` 等 13 个 |
| `core/config/settings-manager.ts` | 19 | `AgentLoopFrameworkSetting`, `AgentLoopFrameworkSettingInput`, `BranchSummarySettings`, `CompactionSettings`, `FileSettingsStorage`, `ImageSettings`, `InMemorySettingsStorage`, `MarkdownSettings` 等 11 个 |
| `extensions/defaults/plan/plan-file-manager.ts` | 18 | `clearAllPlanSlugs`, `clearPlanSlug`, `copyPlanFile`, `copyPlanFileToNewSlug`, `copyPlanForFork`, `copyPlanForResume`, `generatePlanSlug`, `getPlan` 等 10 个 |
| `extensions/defaults/team/team-harness.ts` | 18 | `HarnessExitResult`, `HarnessFeatureList`, `beginHarnessTurn`, `buildCodingPhaseInstructions`, `buildCompletePhaseInstructions`, `buildFixPhaseInstructions`, `buildHarnessInstructions`, `buildInitPhaseInstructions` 等 10 个 |
| `packages/mem-core/src/store-v2.ts` | 18 | `NanoMemV2Paths`, `getV2Paths`, `loadV2Episodes`, `loadV2Facets`, `loadV2Links`, `loadV2Meta`, `loadV2Procedural`, `loadV2Semantic` 等 10 个 |
| `core/session/compaction/compaction.ts` | 17 | `CompactionDetails`, `CompactionPreparation`, `CompactionResult`, `CompactionSettings`, `ContextUsageEstimate`, `CutPointResult`, `DEFAULT_COMPACTION_SETTINGS`, `calculateContextTokens` 等 9 个 |
| `extensions/defaults/debug/collectors.ts` | 17 | `AgentState`, `ConfigInfo`, `DiagnosticData`, `GitInfo`, `ModelInfo`, `PreferencesInfo`, `SessionInfo`, `SystemInfo` 等 9 个 |
| `packages/agent-core/src/types.ts` | 17 | `AgentContext`, `AgentEvent`, `AgentLoopConfig`, `AgentLoopFramework`, `AgentLoopFrameworkInput`, `AgentMessage`, `AgentState`, `AgentTool` 等 9 个 |
| `extensions/defaults/grub/grub-types.ts` | 15 | `FEATURE_LIST_VERSION`, `FeatureCategory`, `FeatureItem`, `FeatureList`, `GrubControllerState`, `GrubDecision`, `GrubDecisionStatus`, `GrubLocale` 等 7 个 |
| `extensions/defaults/loop/cron/cron-tasks.ts` | 15 | `addCronTask`, `addSessionCronTask`, `clearSessionCronTasks`, `deleteCronTask`, `getCronFilePath`, `getCronTask`, `getSessionCronTask`, `getSessionCronTasks` 等 7 个 |
| `core/mcp/index.ts` | 14 | `APIKeyGuidance`, `API_KEY_GUIDANCE`, `MCPClient`, `MCPServerConfig`, `MCPTool`, `MCPToolResult`, `createMCPTool`, `formatGuidanceMessage` 等 6 个 |
| `core/messages.ts` | 14 | `BRANCH_SUMMARY_PREFIX`, `BRANCH_SUMMARY_SUFFIX`, `BashExecutionMessage`, `BranchSummaryMessage`, `COMPACTION_SUMMARY_PREFIX`, `COMPACTION_SUMMARY_SUFFIX`, `CUSTOM_MESSAGE_TYPES_EXCLUDED_FROM_CONTEXT`, `CompactionSummaryMessage` 等 6 个 |
| `nanopencil-defaults.ts` | 14 | `DEFAULT_PENCIL_MD`, `NANOPENCIL_ALI_TOKEN_PLAN_ANTHROPIC_PROVIDER`, `NANOPENCIL_ALI_TOKEN_PLAN_OPENAI_PROVIDER`, `NANOPENCIL_ANTHROPIC_CUSTOM_PROVIDER`, `NANOPENCIL_ARK_CODING_PROVIDER`, `NANOPENCIL_DEFAULT_MODELS_JSON`, `NANOPENCIL_DEFAULT_PROVIDER`, `NANOPENCIL_MINIMAX_CODING_PROVIDER` 等 6 个 |
| `packages/agent-core/src/errors.ts` | 14 | `AgentError`, `ConnectionError`, `ContextOverflowError`, `ExtensionError`, `NetworkError`, `RateLimitError`, `TimeoutError`, `ToolExecutionError` 等 6 个 |
| `core/i18n/index.ts` | 13 | `AVAILABLE_LOCALES`, `LOCALE_NAMES`, `Locale`, `Messages`, `SlashCommands`, `Themes`, `TranslationPaths`, `getLocale` 等 5 个 |
| `core/runtime/agent-session.ts` | 13 | `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `AgentSessionEventListener`, `CycleModelError`, `ExtensionBindings`, `ModelCycleResult`, `ParsedSkillBlock` 等 5 个 |
| `modes/index.ts` | 13 | `InteractiveMode`, `InteractiveModeOptions`, `ModelInfo`, `PrintModeOptions`, `RpcClient`, `RpcClientOptions`, `RpcCommand`, `RpcEventListener` 等 5 个 |
| `core/persona/persona-manager.ts` | 12 | `PersonaManager`, `getActivePersonaId`, `getPersonaDir`, `getPersonaMcpConfigPath`, `getPersonaMemoryDir`, `getPersonaPencilPath`, `getPersonaSkillsDir`, `getPersonaSoulDir` 等 4 个 |
| `extensions/defaults/grub/grub-feature-list.ts` | 12 | `FeatureListDiffError`, `allPassing`, `countPassing`, `createInitialFeatureList`, `defaultFeatureListPath`, `ensureParentDirectory`, `firstPending`, `isFeatureList` 等 4 个 |
| `packages/tui/src/tui.ts` | 12 | `CURSOR_MARKER`, `Component`, `Container`, `Focusable`, `OverlayAnchor`, `OverlayHandle`, `OverlayMargin`, `OverlayOptions` 等 4 个 |
| `core/custom-providers.ts` | 11 | `CUSTOM_ANTHROPIC_PROVIDER`, `CUSTOM_OPENAI_PROVIDER`, `CustomProtocolProviderId`, `ensureCustomProtocolProvidersInModels`, `getCustomProtocolProviderBaseUrl`, `getCustomProtocolProviderDefinition`, `getCustomProtocolProviderModelName`, `isCustomProtocolProvider` 等 3 个 |
| `core/mcp/mcp-config.ts` | 11 | `MCPConfig`, `addMCPServer`, `getMCPConfigPath`, `getMCPServer`, `listEnabledMCPServers`, `listMCPServers`, `loadMCPConfig`, `removeMCPServer` 等 3 个 |
| `core/tools/edit-diff.ts` | 11 | `EditDiffError`, `EditDiffResult`, `FuzzyMatchResult`, `computeEditDiff`, `detectLineEnding`, `fuzzyFindText`, `generateDiffString`, `normalizeForFuzzyMatch` 等 3 个 |
| `extensions/defaults/team/team-presets.ts` | 11 | `AutoTeamPlan`, `AutoTeamResult`, `PRESETS`, `PresetResult`, `PresetSpec`, `PresetTeammateSpec`, `executeAutoTeam`, `executePreset` 等 3 个 |
| `packages/mem-core/src/engine-scoring-v2.ts` | 11 | `V2ScoreBreakdown`, `breakdownEpisodeFacet`, `breakdownEpisodeMemory`, `breakdownProcedural`, `breakdownV2Semantic`, `computeStructuralBoost`, `currentStructuralAnchor`, `scoreEpisodeFacet` 等 3 个 |
| `packages/mem-core/src/scoring.ts` | 11 | `ScoreWeights`, `daysSince`, `decay`, `extractTags`, `getInjectionLevel`, `pickTop`, `scoreEntry`, `scoreEpisode` 等 3 个 |
| `packages/mem-core/src/store.ts` | 11 | `deriveNameFromContent`, `deriveSummaryFromContent`, `loadEntries`, `loadEpisodes`, `loadMeta`, `loadWork`, `readJson`, `saveEntries` 等 3 个 |
| `packages/tui/src/utils.ts` | 11 | `applyBackgroundToLine`, `extractAnsiCode`, `extractSegments`, `getSegmenter`, `isPunctuationChar`, `isWhitespaceChar`, `sliceByColumn`, `sliceWithWidth` 等 3 个 |
| `core/model-resolver.ts` | 10 | `InitialModelResult`, `ParsedModelResult`, `ResolveCliModelResult`, `ScopedModel`, `defaultModelPerProvider`, `findInitialModel`, `parseModelPattern`, `resolveCliModel` 等 2 个 |
| `core/sub-agent/index.ts` | 10 | `InProcessSubAgentBackend`, `SubAgentBackend`, `SubAgentEvent`, `SubAgentHandle`, `SubAgentResult`, `SubAgentRuntime`, `SubAgentSpec`, `SubprocessBackendOptions` 等 2 个 |
| `core/tools/bash.ts` | 10 | `BashOperations`, `BashSandboxOptions`, `BashSpawnContext`, `BashSpawnHook`, `BashToolDetails`, `BashToolInput`, `BashToolOptions`, `bashTool` 等 2 个 |
| `extensions/defaults/sal/terrain.ts` | 10 | `CoverageReport`, `TerrainEdge`, `TerrainNode`, `TerrainNodeKind`, `TerrainSnapshot`, `buildTerrainIndex`, `checkDipCoverage`, `isSnapshotStale` 等 2 个 |
| `extensions/defaults/security-audit/interface.ts` | 10 | `AuditEvent`, `AuditEventStatus`, `AuditEventType`, `DEFAULT_SECURITY_CONFIG`, `LogQueryOptions`, `SecurityCheckResult`, `SecurityConfig`, `SecurityEngine` 等 2 个 |
| `packages/mem-core/src/engine-injection-text.ts` | 10 | `ActiveInjectionData`, `CONVERSATION_PREFERENCE_PATTERNS`, `CueInjectionData`, `InjectedMemoryOrderRecord`, `buildInjectedMemoryOrder`, `buildProgressiveInjectionText`, `isConversationPreference`, `mergeUniqueEntries` 等 2 个 |
| `core/extensions/runner.ts` | 9 | `ExtensionErrorListener`, `ExtensionRunner`, `ForkHandler`, `NavigateTreeHandler`, `NewSessionHandler`, `ReloadHandler`, `ShutdownHandler`, `SwitchSessionHandler` 等 1 个 |
| `core/session/compaction/branch-summarization.ts` | 9 | `BranchPreparation`, `BranchSummaryDetails`, `BranchSummaryResult`, `CollectEntriesResult`, `FileOperations`, `GenerateBranchSummaryOptions`, `collectEntriesForBranchSummary`, `generateBranchSummary` 等 1 个 |
| `core/tools/truncate.ts` | 9 | `DEFAULT_MAX_BYTES`, `DEFAULT_MAX_LINES`, `GREP_MAX_LINE_LENGTH`, `TruncationOptions`, `TruncationResult`, `formatSize`, `truncateHead`, `truncateLine` 等 1 个 |
| `extensions/defaults/sal/anchors.ts` | 9 | `AnchorCandidate`, `AnchorResolution`, `AnchorTargetKind`, `LocateActionInput`, `LocateTaskInput`, `StructuralAnchor`, `locateAction`, `locateTask` 等 1 个 |
| `packages/mem-core/src/embedding-index.ts` | 9 | `EmbeddingIndexFile`, `EmbeddingSourceItem`, `checksumText`, `cosineSimilarity`, `getEmbeddingIndexPath`, `loadEmbeddingIndex`, `queryEmbeddingIndex`, `saveEmbeddingIndex` 等 1 个 |
