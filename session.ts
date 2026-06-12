/**
 * [WHO]: Public session subpath exports for session persistence and entry types
 * [FROM]: Re-exports core/session/session-manager.js
 * [TO]: Consumed by advanced SDK users importing @pencil-agent/nano-pencil/session
 * [HERE]: session.ts - package subpath entry for session APIs
 */

export {
  type BranchSummaryEntry,
  buildSessionContext,
  type CompactionEntry,
  CURRENT_SESSION_VERSION,
  type CustomEntry,
  type CustomMessageEntry,
  type FileEntry,
  getLatestCompactionEntry,
  type ModelChangeEntry,
  migrateSessionEntries,
  type NewSessionOptions,
  parseSessionEntries,
  type SessionContext,
  type SessionEntry,
  type SessionEntryBase,
  type SessionHeader,
  type SessionInfo,
  type SessionInfoEntry,
  SessionManager,
  type SessionMessageEntry,
  type ThinkingLevelChangeEntry,
} from "./core/session/session-manager.js";
