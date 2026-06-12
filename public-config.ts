/**
 * [WHO]: Public config subpath exports for auth, settings, resource, and package managers
 * [FROM]: Re-exports selected core/platform config and package-manager modules
 * [TO]: Consumed by advanced SDK users importing @pencil-agent/nano-pencil/config
 * [HERE]: public-config.ts - package subpath entry for configuration APIs
 */

export {
  type ApiKeyCredential,
  type AuthCredential,
  AuthStorage,
  type AuthStorageBackend,
  FileAuthStorageBackend,
  InMemoryAuthStorageBackend,
  type OAuthCredential,
} from "./core/platform/config/auth-storage.js";
export {
  type CompactionSettings,
  type ImageSettings,
  type PackageSource,
  type RetrySettings,
  SettingsManager,
} from "./core/platform/config/settings-manager.js";
export type { ResourceCollision, ResourceDiagnostic, ResourceLoader } from "./core/platform/config/resource-loader.js";
export { DefaultResourceLoader } from "./core/platform/config/resource-loader.js";
export type {
  PackageManager,
  PathMetadata,
  ProgressCallback,
  ProgressEvent,
  ResolvedPaths,
  ResolvedResource,
} from "./core/package-manager.js";
export { DefaultPackageManager } from "./core/package-manager.js";
