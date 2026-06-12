/**
 * [WHO]: Provides ExtensionFlag, ExtensionFlagOptions, ExtensionFlagValue
 * [FROM]: No dependencies — flags are portable extension metadata
 * [TO]: Consumed by protocol ExtensionAPI and the host extension loader/runner
 * [HERE]: packages/protocol/src/flags.ts - stable CLI/config flag declaration contract
 */

/** Supported values for extension-declared flags. */
export type ExtensionFlagValue = boolean | string;

/** Options an extension passes to `api.registerFlag(...)`. */
export interface ExtensionFlagOptions {
  description?: string;
  type: "boolean" | "string";
  default?: ExtensionFlagValue;
}

/** A runtime flag an extension declares (parsed from CLI/config by the host). */
export interface ExtensionFlag extends ExtensionFlagOptions {
  name: string;
  /** Absolute path of the declaring extension (filled by the host loader). */
  extensionPath: string;
}
