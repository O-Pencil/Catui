# core/platform/i18n/ — Internationalization Module

> P2 | Parent: ../CLAUDE.md

---

## Overview

Internationalization (i18n) module for NanoPencil. Provides multi-language support for UI strings, slash command descriptions, and user-facing messages.

**Supported Languages:**
- `en` — English (default)
- `zh` — 中文 (Chinese)

---

## Member List

`index.ts`: i18n core - locale management, translation function `t()`, type exports
- [FROM]: none
- [WHO]: `i18n`, `t()`, `setLocale()`, `getLocale()`, `AVAILABLE_LOCALES`, `Locale`
- [HERE]: core/platform/i18n/ - central i18n entry point

`slash-commands.ts`: English translations for slash command descriptions
- [FROM]: none
- [WHO]: `slashCommands` object
- [HERE]: core/platform/i18n/slash-commands.ts

`slash-commands.zh.ts`: Chinese translations for slash command descriptions
- [FROM]: none
- [WHO]: `slashCommands` object
- [HERE]: core/platform/i18n/slash-commands.zh.ts

`messages.ts`: English translations for general UI messages
- [FROM]: none
- [WHO]: `messages` object
- [HERE]: core/platform/i18n/messages.ts

`messages.zh.ts`: Chinese translations for general UI messages
- [FROM]: none
- [WHO]: `messages` object
- [HERE]: core/platform/i18n/messages.zh.ts

`themes.ts`: English translations for theme names
- [FROM]: none
- [WHO]: `themes` object
- [HERE]: core/platform/i18n/themes.ts

`themes.zh.ts`: Chinese translations for theme names
- [FROM]: none
- [WHO]: `themes` object
- [HERE]: core/platform/i18n/themes.zh.ts

---

## Translation Keys

### Slash Commands (`slash.*`)
Access via `t("slash.<commandName>")`

### Messages (`msg.*`)
Access via `t("msg.<key>")`

### Themes (`theme.*`)
Access via `t("theme.<themeName>")`

---

## Usage

```typescript
import { t, setLocale, getLocale, AVAILABLE_LOCALES } from "./i18n/index.js";

// Get current locale
const locale = getLocale(); // "en" | "zh"

// Set locale
setLocale("zh");

// Translate
const greeting = t("msg.success"); // "成功" or "Success"
```

---

## Adding New Translations

1. Add key to English file (`messages.ts`)
2. Add Chinese translation to `messages.zh.ts`
3. Use via `t("msg.yourKey")`

---

**Covenant**: When modifying i18n/, update this P2 and verify translations are complete.
