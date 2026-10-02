# core/prompt/

> P2 | Parent: ../AGENT.md

Member List
prompt-templates.ts: PromptTemplate interface, loadPromptTemplates(), PromptTemplateLoader, prompt template loading from markdown files with frontmatter, key invariant: templates loaded from ~/.catui/agent/prompts/ and project .catui/prompts/
system-prompt.ts: BuildSystemPromptOptions interface, buildSystemPrompt(), shared communication/output-format guidance and context loading; default policy favors understandable, verified artifacts while customPrompt replaces the default policy; persona, project context and skill injection remain independent

Rule: Members complete, one item per line, parent links valid, precise terms first

[COVENANT]: Update this file header on changes and verify against parent AGENT.md
