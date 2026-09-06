# cli/

> P2 | Parent: ../AGENT.md

Member List
args.ts: Args, Mode, parseArgs(), printHelp(), two-pass CLI argument parsing (second pass receives extension flags), remote serve flags (--serve/--port/--host/--tunnel), and help display
config-selector.ts: ConfigSelectorOptions, ConfigSelector, runConfigSelector(), TUI config selector for the `catui config` command
file-processor.ts: ProcessedFiles, processFileArguments(), expands @file CLI arguments into text content and resized image attachments
list-models.ts: listModels(), lists available models with fuzzy search for --list-models
output-disconnect.ts: process-level handling for closed CLI output consumers, installed by cli.ts before any fast-path or application output
package-command.ts: PackageCommand/PackageCommandOptions types, parsePackageCommand(), printPackageCommandHelp(), handlePackageCommand(), install/remove/update/list package subcommands
session-options.ts: buildSessionOptions(), maps parsed CLI flags + scoped models into CreateAgentSessionOptions for primary and ACP workspace sessions
session-picker.ts: selectSession(), TUI session selector for --resume
session-start.ts: prepareInitialMessage(), resolveSessionPath(), promptConfirm(), createSessionManager(), resolves @file args and session flags into initial message + SessionManager
subcommands.ts: reportSettingsErrors(), handleConfigCommand(), handleMigrateCommand(), early-exit config/migrate subcommands plus shared settings error drain helper

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
