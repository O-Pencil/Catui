/**
 * [WHO]: Provides noopSink (no-op EvalSink implementation)
 * [FROM]: Depends on ./types.js for EvalSink interface
 * [TO]: Consumed by eval/index.ts factory as the disabled-state default
 * [HERE]: extensions/builtin/sal/eval/noop-sink.ts - silent sink used when eval collection is disabled or no adapter is configured
 */

import type { EvalSink } from "./types.js";

export const noopSink: EvalSink = {
	enabled: false,
	sendEvent: async () => {},
	flush: async () => {},
	close: async () => {},
};
