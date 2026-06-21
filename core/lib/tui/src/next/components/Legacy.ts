/**
 * [WHO]: NextLegacy, LegacyProps
 * [FROM]: Depends on ../types.js for tui-next legacy component node contracts
 * [TO]: Consumed by core/lib/tui/src/next/index.ts and legacy adapter users
 * [HERE]: core/lib/tui/src/next/components/Legacy.ts - wraps existing Component renderers in tui-next trees
 */

import type { Component } from "../../tui.js";
import type { LegacyNode } from "../types.js";

export interface LegacyProps {
	readonly component: Component;
}

export function NextLegacy(props: LegacyProps): LegacyNode {
	return {
		type: "legacy",
		component: props.component,
	};
}
