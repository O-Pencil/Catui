/**
 * [WHO]: calculate test utility - simple calculator for agent testing
 * [FROM]: Depends on @sinclair/typebox, ../../src/types
 * [TO]: Consumed by agent-core tests
 * [HERE]: core/lib/agent-core/test/utils/calculate.ts - test utility
 */

import { type Static, Type } from "@sinclair/typebox";
import type { AgentTool, AgentToolResult } from "../../src/types.js";

export interface CalculateResult extends AgentToolResult<undefined> {
	content: Array<{ type: "text"; text: string }>;
	details: undefined;
}

export function calculate(expression: string): CalculateResult {
	try {
		const result = new Function(`return ${expression}`)();
		return { content: [{ type: "text", text: `${expression} = ${result}` }], details: undefined };
	} catch (e: unknown) {
		throw new Error(e instanceof Error ? e.message : String(e));
	}
}

const calculateSchema = Type.Object({
	expression: Type.String({ description: "The mathematical expression to evaluate" }),
});

type CalculateParams = Static<typeof calculateSchema>;

export const calculateTool: AgentTool<typeof calculateSchema, undefined> = {
	label: "Calculator",
	name: "calculate",
	description: "Evaluate mathematical expressions",
	parameters: calculateSchema,
	execute: async (_toolCallId: string, args: CalculateParams) => {
		return calculate(args.expression);
	},
};
