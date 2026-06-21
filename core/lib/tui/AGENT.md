# core/lib/tui/

> P2 | Parent: ../AGENT.md

Member List
stdin-buffer.ts: StdinBuffer class, stdin buffering for escape sequences, accumulates partial input chunks
terminal-image.ts: ImageProtocol, TerminalCapabilities, CellDimensions, terminal image protocol support for kitty/iterm2
autocomplete.ts: AutocompleteItem, SlashCommand, AutocompleteProvider, CombinedAutocompleteProvider, autocomplete engine with fuzzy matching
tui.ts: Component, Focusable, TUI class, minimal TUI implementation with differential rendering
undo-stack.ts: UndoStack class, generic undo stack with clone-on-push semantics, stores deep clones of state snapshots
kill-ring.ts: KillRing class, Emacs-style kill/yank operations, ring buffer for killed text entries
utils.ts: getSegmenter, visibleWidth, wrapTextWithAnsi, text utilities for grapheme segmentation and ANSI handling
keys.ts: KeyId, matchesKey, parseKey, keyboard input handling, supports Kitty keyboard protocol and legacy sequences
editor-component.ts: EditorComponent interface, custom editor component interface for extensions (vim/emacs modes)
keybindings.ts: EditorKeybindingsManager, getEditorKeybindings, setEditorKeybindings, editor action keybinding definitions
terminal.ts: Terminal, ProcessTerminal, terminal detection and configuration, stdin/stdout management
index.ts: tui barrel exports, entry point for package, exports legacy components/core TUI classes plus controlled tui-next bridge symbols
fuzzy.ts: FuzzyMatch, fuzzyMatch, fuzzyFilter, fuzzy matching utilities for ordered character matching
components/cancellable-loader.ts: CancellableLoader class, interruptible loading indicator with AbortSignal support
components/image.ts: ImageTheme, ImageOptions, Image class, image component using terminal protocols
components/editor.ts: TextChunk, EditorTheme, Editor class, full-featured text editor with autocomplete and undo
components/text.ts: Text class, multi-line text display with word wrapping and ANSI support
components/input.ts: Input class, single-line input field with undo and kill-ring support
components/markdown.ts: DefaultTextStyle, MarkdownTheme, Markdown class, markdown renderer using marked library
components/loader.ts: Loader class, loading indicator with spinning animation (80ms update interval)
components/settings-list.ts: SettingItem, SettingsListTheme, SettingsList class, settings list with fuzzy search and input
components/spacer.ts: Spacer class, spacer element rendering empty lines
components/box.ts: Box class, box/drawing primitive with background and child rendering
components/truncated-text.ts: TruncatedText class, text truncation to fit viewport width
components/select-list.ts: SelectItem, SelectListTheme, SelectList class, selectable list with keyboard navigation and width-clamped no-match output
next/types.ts: NextChild, NextNode, TextNode, BoxNode — internal tui-next node contracts for CC-style primitives
next/components/Text.ts: Text, TextProps — CC-style text primitive for tui-next isolated renderer
next/components/Box.ts: Box, BoxProps — CC-style box primitive for tui-next isolated renderer
next/components/Legacy.ts: NextLegacy, LegacyProps — embeds existing legacy Component instances inside tui-next trees
next/legacy-adapter.ts: createNextComponent, internal render-to-lines bridge from tui-next nodes to legacy Component with width-clamped legacy child output
next/index.ts: tui-next internal barrel exports for isolated migration tests and future interactive slices
vitest.config.ts: Vitest configuration for TUI package tests

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
