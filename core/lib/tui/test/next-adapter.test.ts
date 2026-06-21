import assert from "node:assert";
import { describe, it } from "node:test";
import { Markdown, NextBox, NextLegacy, NextText, createNextComponent } from "../src/index.js";
import { visibleWidth } from "../src/utils.js";
import { defaultMarkdownTheme } from "./test-themes.js";

describe("tui-next legacy adapter", () => {
	it("renders Box and Text through the legacy Component interface", () => {
		const component = createNextComponent(
			NextBox({
				paddingX: 1,
				children: NextText({ children: "hello" }),
			}),
		);

		const lines = component.render(10);

		assert.deepStrictEqual(lines, [" hello    "]);
		assert.ok(lines.every((line) => visibleWidth(line) === 10));
	});

	it("clips embedded legacy component lines to the next tree width", () => {
		const legacy = new Markdown("你好", 1, 0, defaultMarkdownTheme);
		const component = createNextComponent(NextLegacy({ component: legacy }));

		const lines = component.render(2);

		assert.ok(lines.length > 0);
		for (const line of lines) {
			assert.ok(
				visibleWidth(line) <= 2,
				`Expected embedded legacy line to fit width 2, got ${visibleWidth(line)} for ${JSON.stringify(line)}`,
			);
		}
	});
});
