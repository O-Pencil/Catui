/**
 * [WHO]: Type declarations for @pencil-agent/nano-pencil host interface
 * [FROM]: No external dependencies
 * [TO]: Consumed by packages/mem-core for host type checking
 * [HERE]: packages/mem-core/src/nano-pencil-host.d.ts - ambient type declarations
 */

declare module "@pencil-agent/nano-pencil" {
	export type ExtensionContext = {
		cwd: string;
		hasUI?: boolean;
		sessionManager: {
			getSessionFile(): string | undefined;
		};
		ui: {
			setStatus(namespace: string, message: string): void;
			notify(message: string, level?: string): void;
		};
		getSettings?: () => {
			nanomem?: {
				autoDream?: {
					enabled?: boolean;
					minHours?: number;
					minSessions?: number;
					scanIntervalMinutes?: number;
				};
				dream?: {
					lockStaleMinutes?: number;
				};
			};
		};
	};

	export type ExtensionEventMap = {
		session_start: unknown;
		turn_end: unknown;
		before_agent_start: { prompt?: string };
		tool_execution_start: {
			toolCallId: string;
			toolName: string;
			args: Record<string, unknown>;
		};
		tool_execution_end: {
			toolCallId: string;
			toolName: string;
			result: unknown;
			isError: boolean;
		};
		agent_end: {
			messages: Array<{ role: string; content?: unknown }>;
		};
		session_shutdown: unknown;
	};

	export type ExtensionAPI = {
		events: {
			emit(channel: string, data: unknown): void;
		};
		on<TEvent extends keyof ExtensionEventMap>(
			event: TEvent,
			handler: (event: ExtensionEventMap[TEvent], context: ExtensionContext) => unknown,
		): void;
		on(event: string, handler: (event: unknown, context: ExtensionContext) => unknown): void;
		registerCommand(
			name: string,
			command: {
				description: string;
				handler: (args: string, context: ExtensionContext) => unknown;
			},
		): void;
		registerTool(tool: unknown): void;
	};

	export class SessionManager {
		static countTouchedSince(
			cwd: string,
			lastAtMs: number,
			options?: {
				excludeBasename?: string;
			},
		): Promise<number>;
	}
}
