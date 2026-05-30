/**
 * [WHO]: ProviderSelectorComponent
 * [FROM]: Depends on @pencil-agent/tui, ../theme/theme.js, ./dynamic-border.js
 * [TO]: Consumed by modes/interactive/interactive-mode.ts
 * [HERE]: modes/interactive/components/provider-selector.ts -
 *   Adds search to provider selection when /model has many providers
 */

import {
	type Focusable,
	Container,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	Spacer,
	Text,
} from "@pencil-agent/tui";
import {
	getCustomProtocolProviderDefinition,
	isCustomProtocolProvider,
} from "../../../core/model/custom-providers.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";

interface ProviderItem {
	value: string;
	label: string;
	description?: string;
	isCurrent: boolean;
}

export class ProviderSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private listContainer: Container;
	private allProviders: ProviderItem[];
	private filteredProviders: ProviderItem[];
	private selectedIndex = 0;
	private onSelectCallback: (provider: string) => void;
	private onCancelCallback: () => void;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		providers: string[],
		currentProvider: string | undefined,
		onSelect: (provider: string) => void,
		onCancel: () => void,
	) {
		super();

		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		// Build provider items with custom protocol labels
		this.allProviders = providers.map((provider) => {
			const customProvider = isCustomProtocolProvider(provider)
				? getCustomProtocolProviderDefinition(provider)
				: undefined;

			return {
				value: provider,
				label: customProvider?.label ?? provider,
				description: customProvider?.description,
				isCurrent: provider === currentProvider,
			};
		});

		this.filteredProviders = [...this.allProviders];

		// Set initial selection to current provider
		if (currentProvider) {
			const currentIdx = this.allProviders.findIndex(
				(p) => p.value === currentProvider,
			);
			if (currentIdx >= 0) {
				this.selectedIndex = currentIdx;
			}
		}

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));
		this.addChild(
			new Text(theme.fg("muted", "Search provider:"), 0, 0),
		);
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		this.searchInput.onSubmit = () => {
			if (this.filteredProviders[this.selectedIndex]) {
				this.onSelectCallback(
					this.filteredProviders[this.selectedIndex].value,
				);
			}
		};
		this.addChild(this.searchInput);

		this.addChild(new Spacer(1));
		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.updateList();
	}

	private filterProviders(query: string): void {
		const filtered = query
			? fuzzyFilter(this.allProviders, query, (p) => `${p.label} ${p.value}`)
			: [...this.allProviders];
		this.filteredProviders = filtered;
		// Reset selectedIndex to first item when filter changes
		this.selectedIndex = 0;
		this.updateList();
	}

	private updateList(): void {
		// Remove all old children
		while (this.listContainer.children.length > 0) {
			this.listContainer.children.pop();
		}

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(maxVisible / 2),
				this.filteredProviders.length - maxVisible,
			),
		);
		const endIndex = Math.min(
			startIndex + maxVisible,
			this.filteredProviders.length,
		);

		for (let index = startIndex; index < endIndex; index++) {
			const item = this.filteredProviders[index];
			if (!item) continue;

			const isSelected = index === this.selectedIndex;
			const prefix = isSelected
				? theme.fg("accent", "->")
				: "  ";
			const labelText = isSelected
				? theme.fg("accent", item.label)
				: item.label;
			const currentTag = item.isCurrent
				? theme.fg("success", " [current]")
				: "";
			const descText = item.description
				? theme.fg("muted", ` ${item.description}`)
				: "";

			this.listContainer.addChild(
				new Text(`${prefix}${labelText}${currentTag}${descText}`, 0, 0),
			);
		}

		if (startIndex > 0 || endIndex < this.filteredProviders.length) {
			this.listContainer.addChild(
				new Text(
					theme.fg(
						"muted",
						`  (${this.selectedIndex + 1}/${this.filteredProviders.length})`,
					),
					0,
					0,
				),
			);
		}

		if (this.filteredProviders.length === 0) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", "  No matching providers"), 0, 0),
			);
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();

		if (kb.matches(keyData, "selectUp")) {
			if (this.filteredProviders.length === 0) return;
			this.selectedIndex =
				this.selectedIndex === 0
					? this.filteredProviders.length - 1
					: this.selectedIndex - 1;
			this.updateList();
		} else if (kb.matches(keyData, "selectDown")) {
			if (this.filteredProviders.length === 0) return;
			this.selectedIndex =
				this.selectedIndex === this.filteredProviders.length - 1
					? 0
					: this.selectedIndex + 1;
			this.updateList();
		} else if (kb.matches(keyData, "selectConfirm")) {
			const selected = this.filteredProviders[this.selectedIndex];
			if (selected) {
				this.onSelectCallback(selected.value);
			}
		} else if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterProviders(this.searchInput.getValue());
		}
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
