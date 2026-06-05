/**
 * [WHO]: Provides ModelSelectorComponent — model picker UI with scope/filter/add-OpenRouter affordances
 * [FROM]: Depends on @pencil-agent/ai, @pencil-agent/tui, model-registry types, theme,
 *         DynamicBorder, keybinding hints
 * [TO]: Consumed by modes/interactive/interactive-mode.ts and components/index.ts; emits selected
 *       models only, while provider configuration is owned by the caller
 * [HERE]: modes/interactive/components/model-selector.ts — presentation component for model selection
 */

import type { Model } from "@pencil-agent/ai/types";
import { modelsAreEqual } from "@pencil-agent/ai/models";
import {
	Container,
	type Focusable,
	fuzzyFilter,
	getEditorKeybindings,
	Input,
	matchesKey,
	Spacer,
	Text,
	type TUI,
} from "@pencil-agent/tui";
import type { ModelRegistry } from "../../../core/model-registry.js";
import { theme } from "../theme/theme.js";
import { DynamicBorder } from "./dynamic-border.js";
import { keyHint } from "./keybinding-hints.js";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

interface ScopedModelItem {
	model: Model<any>;
	thinkingLevel: string;
}

type ModelScope = "all" | "scoped";

export class ModelSelectorComponent extends Container implements Focusable {
	private searchInput: Input;
	private _focused = false;
	private listContainer: Container;
	private allModels: ModelItem[] = [];
	private scopedModelItems: ModelItem[] = [];
	private activeModels: ModelItem[] = [];
	private filteredModels: ModelItem[] = [];
	private selectedIndex = 0;
	private currentModel?: Model<any>;
	private modelRegistry: ModelRegistry;
	private onSelectCallback: (model: Model<any>) => void;
	private onCancelCallback: () => void;
	private errorMessage?: string;
	private tui: TUI;
	private scopedModels: ReadonlyArray<ScopedModelItem>;
	private scope: ModelScope = "all";
	private scopeText?: Text;
	private scopeHintText?: Text;
	private filterByProvider?: string;
	/** When set, Ctrl+N runs this (parent closes selector and prompts for OpenRouter model id). */
	private onAddOpenRouterModel?: () => void;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		tui: TUI,
		currentModel: Model<any> | undefined,
		modelRegistry: ModelRegistry,
		scopedModels: ReadonlyArray<ScopedModelItem>,
		onSelect: (model: Model<any>) => void,
		onCancel: () => void,
		initialSearchInput?: string,
		filterByProvider?: string,
		onAddOpenRouterModel?: () => void,
	) {
		super();

		this.tui = tui;
		this.currentModel = currentModel;
		this.modelRegistry = modelRegistry;
		this.scopedModels = scopedModels;
		this.filterByProvider = filterByProvider;
		this.onAddOpenRouterModel = onAddOpenRouterModel;
		this.scope = scopedModels.length > 0 && !filterByProvider ? "scoped" : "all";
		this.onSelectCallback = onSelect;
		this.onCancelCallback = onCancel;

		this.addChild(new DynamicBorder());
		this.addChild(new Spacer(1));

		if (this.filterByProvider) {
			this.addChild(
				new Text(theme.fg("muted", `Provider: ${this.filterByProvider}`), 0, 0),
			);
		} else if (scopedModels.length > 0) {
			this.scopeText = new Text(this.getScopeText(), 0, 0);
			this.addChild(this.scopeText);
			this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
			this.addChild(this.scopeHintText);
		}
		this.addChild(new Spacer(1));

		this.searchInput = new Input();
		if (initialSearchInput) {
			this.searchInput.setValue(initialSearchInput);
		}
		this.searchInput.onSubmit = () => {
			if (this.filteredModels[this.selectedIndex]) {
				void this.handleSelect(this.filteredModels[this.selectedIndex].model);
			}
		};
		this.addChild(this.searchInput);

		if (this.onAddOpenRouterModel) {
			this.addChild(new Spacer(1));
			this.addChild(
				new Text(
					theme.fg("muted", "Ctrl+N: add OpenRouter model by id (same as openrouter.ai)"),
					0,
					0,
				),
			);
		}

		this.addChild(new Spacer(1));
		this.listContainer = new Container();
		this.addChild(this.listContainer);
		this.addChild(new Spacer(1));
		this.addChild(new DynamicBorder());

		this.loadModels().then(() => {
			if (initialSearchInput) {
				this.filterModels(initialSearchInput);
			} else {
				this.updateList();
			}
			this.tui.requestRender();
		});
	}

	private async loadModels(): Promise<void> {
		let models: ModelItem[];

		this.modelRegistry.refresh();
		const loadError = this.modelRegistry.getError();
		if (loadError) {
			this.errorMessage = loadError;
		}

		try {
			const allModels = this.modelRegistry.getAll();
			models = allModels.map((model: Model<any>) => ({
				provider: model.provider,
				id: model.id,
				model,
			}));
		} catch (error) {
			this.allModels = [];
			this.scopedModelItems = [];
			this.activeModels = [];
			this.filteredModels = [];
			this.errorMessage =
				error instanceof Error ? error.message : String(error);
			return;
		}

		this.allModels = this.sortModels(models);
		if (this.filterByProvider) {
			const provider = this.filterByProvider.toLowerCase();
			this.allModels = this.allModels.filter(
				(model) => model.provider.toLowerCase() === provider,
			);
		}
		this.scopedModelItems = this.sortModels(
			this.scopedModels.map((scoped) => ({
				provider: scoped.model.provider,
				id: scoped.model.id,
				model: scoped.model,
			})),
		);
		this.activeModels =
			this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		if (this.filterByProvider) {
			this.activeModels = this.allModels;
		}
		this.filteredModels = this.activeModels;
		this.selectedIndex = Math.min(
			this.selectedIndex,
			Math.max(0, this.filteredModels.length - 1),
		);
	}

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		sorted.sort((a, b) => {
			const aIsCurrent = modelsAreEqual(this.currentModel, a.model);
			const bIsCurrent = modelsAreEqual(this.currentModel, b.model);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider);
		});
		return sorted;
	}

	private getScopeText(): string {
		const allText =
			this.scope === "all"
				? theme.fg("accent", "all")
				: theme.fg("muted", "all");
		const scopedText =
			this.scope === "scoped"
				? theme.fg("accent", "scoped")
				: theme.fg("muted", "scoped");
		return `${theme.fg("muted", "Scope: ")}${allText}${theme.fg("muted", " | ")}${scopedText}`;
	}

	private getScopeHintText(): string {
		return keyHint("tab", "scope") + theme.fg("muted", " (all/scoped)");
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels =
			this.scope === "scoped" ? this.scopedModelItems : this.allModels;
		this.selectedIndex = 0;
		this.filterModels(this.searchInput.getValue());
		if (this.scopeText) {
			this.scopeText.setText(this.getScopeText());
		}
	}

	private filterModels(query: string): void {
		this.filteredModels = query
			? fuzzyFilter(this.activeModels, query, ({ id, provider }) => `${id} ${provider}`)
			: this.activeModels;
		this.selectedIndex = Math.min(
			this.selectedIndex,
			Math.max(0, this.filteredModels.length - 1),
		);
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();

		const maxVisible = 10;
		const startIndex = Math.max(
			0,
			Math.min(
				this.selectedIndex - Math.floor(maxVisible / 2),
				this.filteredModels.length - maxVisible,
			),
		);
		const endIndex = Math.min(
			startIndex + maxVisible,
			this.filteredModels.length,
		);

		for (let index = startIndex; index < endIndex; index++) {
			const item = this.filteredModels[index];
			if (!item) continue;

			const isSelected = index === this.selectedIndex;
			const isCurrent = modelsAreEqual(this.currentModel, item.model);
			const needsKey = !this.modelRegistry.authStorage.hasAuth(item.provider);

			const prefix = isSelected
				? theme.fg("accent", "->")
				: "  ";
			const modelText = isSelected
				? theme.fg("accent", item.id)
				: item.id;
			const providerBadge = theme.fg("muted", `[${item.provider}]`);
			const checkmark = isCurrent ? theme.fg("success", " [current]") : "";
			const needsKeyHint = needsKey
				? theme.fg("warning", " [needs API key]")
				: "";

			this.listContainer.addChild(
				new Text(`${prefix}${modelText} ${providerBadge}${checkmark}${needsKeyHint}`, 0, 0),
			);
		}

		if (startIndex > 0 || endIndex < this.filteredModels.length) {
			this.listContainer.addChild(
				new Text(
					theme.fg(
						"muted",
						`  (${this.selectedIndex + 1}/${this.filteredModels.length})`,
					),
					0,
					0,
				),
			);
		}

		if (this.errorMessage) {
			for (const line of this.errorMessage.split("\n")) {
				this.listContainer.addChild(new Text(theme.fg("error", line), 0, 0));
			}
		} else if (this.filteredModels.length === 0) {
			this.listContainer.addChild(
				new Text(theme.fg("muted", "  No matching models"), 0, 0),
			);
		} else {
			const selected = this.filteredModels[this.selectedIndex];
			this.listContainer.addChild(new Spacer(1));
			this.listContainer.addChild(
				new Text(
					theme.fg("muted", `  Model Name: ${selected.model.name}`),
					0,
					0,
				),
			);
		}
	}

	handleInput(keyData: string): void {
		const kb = getEditorKeybindings();
		if (kb.matches(keyData, "tab")) {
			if (!this.filterByProvider && this.scopedModelItems.length > 0) {
				const nextScope: ModelScope =
					this.scope === "all" ? "scoped" : "all";
				this.setScope(nextScope);
				if (this.scopeHintText) {
					this.scopeHintText.setText(this.getScopeHintText());
				}
			}
			return;
		}

		if (kb.matches(keyData, "selectUp")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex =
				this.selectedIndex === 0
					? this.filteredModels.length - 1
					: this.selectedIndex - 1;
			this.updateList();
		} else if (kb.matches(keyData, "selectDown")) {
			if (this.filteredModels.length === 0) return;
			this.selectedIndex =
				this.selectedIndex === this.filteredModels.length - 1
					? 0
					: this.selectedIndex + 1;
			this.updateList();
		} else if (kb.matches(keyData, "selectConfirm")) {
			const selectedModel = this.filteredModels[this.selectedIndex];
			if (selectedModel) {
				void this.handleSelect(selectedModel.model);
			}
		} else if (kb.matches(keyData, "selectCancel")) {
			this.onCancelCallback();
		} else if (this.onAddOpenRouterModel && matchesKey(keyData, "ctrl+n")) {
			this.onAddOpenRouterModel();
		} else {
			this.searchInput.handleInput(keyData);
			this.filterModels(this.searchInput.getValue());
		}
	}

	private async handleSelect(model: Model<any>): Promise<void> {
		try {
			const refreshedModel =
				this.modelRegistry.find(model.provider, model.id) ?? model;
			this.onSelectCallback(refreshedModel);
		} catch (error) {
			// Ensure selector is closed on any error
			this.onCancelCallback();
			throw error;
		}
	}

	getSearchInput(): Input {
		return this.searchInput;
	}
}
