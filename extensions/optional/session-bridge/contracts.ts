/**
 * [WHO]: Local bridge limits, errors, registry and session capability contracts
 * [FROM]: No runtime dependencies
 * [TO]: Session bridge transport and controller; not a public package protocol
 * [HERE]: extensions/optional/session-bridge/contracts.ts - private wire boundary
 */
export const MAX_BODY_BYTES = 32768;
export const MAX_MESSAGE_CHARS = 12000;
export const MAX_RECEIPTS = 128;
export interface BridgeDescriptor {
  version: 1;
  bridgeId: string;
  sessionId: string;
  cwd: string;
  pid: number;
  port: number;
  token: string;
  startedAt: string;
}
export interface BridgeHost {
  supervision?: import("../../../core/extensions-host/types.js").ExtensionAPI["supervision"];
  commands?: () => Array<{ name: string; description?: string; source: string }>;
  sessionId(): string;
  isIdle(): boolean;
  hasPendingMessages(): boolean;
  send(text: string, mode: "followUp" | "steer"): void;
  abort(): void;
}
export interface Receipt {
  requestId: string;
  status: "submitted" | "observed" | "failed";
  mode: "followUp" | "steer";
  submittedAt: string;
  observedAt?: string;
}
export class BridgeError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BridgeError(400, "Expected an object");
  return value as Record<string, unknown>;
}
