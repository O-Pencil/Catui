# core/tools/

> P2 | Parent: ../AGENT.md

Member List
read.ts: ReadTool, readTool, createReadTool, ReadToolInput, filesystem read boundary with truncation and line range support, consumed by orchestrator
source.ts: ToolSourceType, ToolSource interface, SourceTool, tool source abstraction (builtin, MCP, extension), key method: load() returns ToolDefinition[]
find.ts: FindTool, findTool, createFindTool, FindToolInput, file pattern matching via glob, consumed by orchestrator
orchestrator.ts: ToolInfo interface, ToolOrchestrator class, runtime tool registry, lookup, and active-tool resolution for AgentSession
path-utils.ts: resolveReadPath(), resolveToCwd(), path manipulation utilities for tools, handles Unicode spaces and macOS NFD normalization
input-validation.ts: validateIntegerWindowOption(), validatePositiveNumberOption(), shared numeric invariants for tool inputs
write-guard.ts: createWorkspaceWriteGuard(), isPathWithinRoot(), shared filesystem write boundary helpers for keeping write tools inside a workspace root
ls.ts: LsTool, lsTool, createLsTool, LsToolInput, directory listing with metadata, consumed by orchestrator
grep.ts: GrepTool, grepTool, createGrepTool, GrepToolInput, content search via ripgrep, consumed by orchestrator
edit.ts: EditTool, editTool, createEditTool, EditToolInput, EditOperations, EditToolOptions.beforeWrite guard, filesystem mutation via diff application, consumed by orchestrator
bash.ts: BashTool, bashTool, createBashTool, BashToolInput, BashToolDetails, createSandboxHook with optional simple write-path allowlist, shell command execution with timeout/streaming, consumed by orchestrator
index.ts: Tool registry, all tool creators and types, tool system public API, passes edit/write options through createCodingTools/createAllTools, re-exports from all tool modules
write.ts: WriteTool, writeTool, createWriteTool, WriteToolInput, WriteToolOptions.beforeWrite guard, filesystem creation/overwrite, consumed by orchestrator
file-state-cache.ts: FileStateCache, FileState, fileStateCache singleton, LRU cache tracking file read state (content + mtime) for staleness detection, consumed by read/edit/write tools
edit-diff.ts: detectLineEnding(), fuzzyFindText(), generateDiffString(), normalizeToLF(), restoreLineEndings(), shared diff computation for edit tool
truncate.ts: TruncationResult, truncateHead(), truncateTail(), formatSize(), shared truncation utilities for tool outputs, constants: DEFAULT_MAX_LINES, DEFAULT_MAX_BYTES, GREP_MAX_LINE_LENGTH
time.ts: TimeTool, timeTool, createTimeTool, current time tool with timezone/locale formatting, consumed by orchestrator
pdf-extract.ts: extractPdfText(), extractPdfPages(), PDF text extraction utility using pdfjs-dist, consumed by read tool

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
