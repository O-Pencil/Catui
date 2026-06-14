/**
 * [WHO]: BuildSystemPromptOptions, buildSystemPrompt()
 * [FROM]: Depends on config, skills, tools
 * [TO]: Consumed by core/runtime/agent-session.ts
 * [HERE]: core/prompt/system-prompt.ts - system prompt building and context loading
 */
import { getDocsPath, getExamplesPath, getReadmePath } from "../../config.js";
import { formatSkillsForPrompt, type Skill } from "../skills.js";
import { getToolGuidance, toolGuidance } from "../tools/index.js";

/** Tool descriptions (for system prompt) - dynamically obtained from tools/index.js */
const toolDescriptions: Record<string, string> = toolGuidance;

export interface BuildSystemPromptOptions {
  /** Custom system prompt (replaces default). */
  customPrompt?: string;
  /** Tools to include in prompt. Default: [read, bash, edit, write] */
  selectedTools?: string[];
  /** Text to append to system prompt. */
  appendSystemPrompt?: string;
  /** Working directory. Default: process.cwd() */
  cwd?: string;
  /** Preloaded context files. */
  contextFiles?: Array<{ path: string; content: string }>;
  /** Preloaded skills. */
  skills?: Skill[];
  /** Soul injection text (AI personality) */
  soulInjection?: string;
  /** Guidance for extension tools (collected from ToolDefinition.guidance) */
  extensionToolsGuidance?: Record<string, string>;
}

function buildSoulSection(soulInjection?: string): string {
  if (!soulInjection?.trim()) return "";
  return [
    "## Stable Personality Layer",
    "Use this section for long-term collaboration style, personality, and relationship cues only.",
    "Do not repeat short-term presence lines, temporary memory recall blocks, or raw factual preference lists unless the user asks.",
    "",
    soulInjection.trim(),
  ].join("\n");
}

/** Build system prompt from tools, rules, and context */
export function buildSystemPrompt(
  options: BuildSystemPromptOptions = {},
): string {
  const {
    customPrompt,
    selectedTools,
    appendSystemPrompt,
    cwd,
    contextFiles: providedContextFiles,
    skills: providedSkills,
    soulInjection,
    extensionToolsGuidance = {},
  } = options;
  const resolvedCwd = cwd ?? process.cwd();

  const now = new Date();
  const dateTime = now.toLocaleString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  });
  const timeReasoningInstruction =
    "\nFor exact current time or any date-sensitive reasoning, you must use the `time` tool before answering. This includes questions about the current time, current date, today, tomorrow, yesterday, this week, deadlines, elapsed time, or anything that depends on the real system clock. Do not rely only on this prompt timestamp for those answers.";

  const appendSection = appendSystemPrompt ? `\n\n${appendSystemPrompt}` : "";
  const soulSection = buildSoulSection(soulInjection);

  const contextFiles = providedContextFiles ?? [];
  const skills = providedSkills ?? [];

  // Separate persona CATUI.md from other context files.
  // Persona content defines identity/personality and should be injected at
  // higher priority than project context files.
  const isPersonaFile = (f: { path: string }) =>
    f.path.includes("/personas/") && f.path.endsWith("/CATUI.md");
  const personaFiles = contextFiles.filter(isPersonaFile);
  const projectFiles = contextFiles.filter((f) => !isPersonaFile(f));

  if (customPrompt) {
    let prompt = customPrompt;

    if (soulSection) {
      prompt += `\n\n${soulSection}`;
    }

    // Inject persona identity before project context
    if (personaFiles.length > 0) {
      prompt += "\n\n# Your Identity\n\n";
      for (const { path: filePath, content } of personaFiles) {
        prompt += `${content}\n\n`;
      }
    }

    if (appendSection) {
      prompt += appendSection;
    }

    // Append project context files
    if (projectFiles.length > 0) {
      prompt += "\n\n# Project Context\n\n";
      prompt += "Project-related rules and specifications:\n\n";
      for (const { path: filePath, content } of projectFiles) {
        prompt += `## ${filePath}\n\n${content}\n\n`;
      }
    }

    // Append skills section (only when read tool is available)
    const customPromptHasRead =
      !selectedTools || selectedTools.includes("read");
    if (customPromptHasRead && skills.length > 0) {
      prompt += formatSkillsForPrompt(skills);
    }

    // Finally append date/time and working directory
    prompt += `\nCurrent date and time: ${dateTime}`;
    prompt += `\nCurrent working directory: ${resolvedCwd}`;

    prompt += timeReasoningInstruction;
    return prompt;
  }

  // Get absolute paths for docs and examples
  const readmePath = getReadmePath();
  const docsPath = getDocsPath();
  const examplesPath = getExamplesPath();

  // Build tool list based on selected tools (only include built-in tools with descriptions)
  const tools = (selectedTools || ["read", "bash", "edit", "write", "time"]).filter(
    (t) => t in toolDescriptions,
  );

  // Merge built-in tool and extension tool guidance
  const allToolDescriptions: Record<string, string> = { ...toolDescriptions, ...extensionToolsGuidance };

  const toolsList =
    tools.length > 0
      ? tools.map((t) => `- ${t}: ${allToolDescriptions[t]}`).join("\n")
      : "(none)";

  // Add extension tool list (tools without built-in guidance)
  const extensionOnlyTools = selectedTools?.filter((t) => !toolDescriptions[t] && extensionToolsGuidance[t]) || [];
  const extensionToolsList =
    extensionOnlyTools.length > 0
      ? extensionOnlyTools.map((t) => `- ${t}: ${extensionToolsGuidance[t]}`).join("\n")
      : null;

  // Build rules based on actually available tools
  const guidelinesList: string[] = [];

  const hasBash = tools.includes("bash");
  const hasEdit = tools.includes("edit");
  const hasWrite = tools.includes("write");
  const hasGrep = tools.includes("grep");
  const hasFind = tools.includes("find");
  const hasLs = tools.includes("ls");
  const hasRead = tools.includes("read");

  // File exploration related rules
  if (hasBash && !hasGrep && !hasFind && !hasLs) {
    guidelinesList.push("Use bash for ls, rg, find and other file operations");
  } else if (hasBash && (hasGrep || hasFind || hasLs)) {
    guidelinesList.push(
      "Prefer using grep/find/ls tools for file exploration (faster, respects .gitignore)",
    );
  }

  // Read before edit rules
  if (hasRead && hasEdit) {
    guidelinesList.push(
      "Before editing, use read to view file content. Must use this tool, not cat or sed.",
    );
  }

  // Edit rules
  if (hasEdit) {
    guidelinesList.push("Use edit for precise modifications (old text must match exactly)");
  }

  // Write rules
  if (hasWrite) {
    guidelinesList.push("Use write only when creating new files or complete rewrite");
  }

  // Output rules (only when actually writing or executing)
  if (hasEdit || hasWrite) {
    guidelinesList.push(
      "When summarizing your actions, output plain text directly, don't use cat or bash to show what you did",
    );
  }

  // Always include the following
  guidelinesList.push("Be concise when performing technical tasks (code, file ops, analysis). For casual conversation, respond naturally and warmly.");
  guidelinesList.push("Clearly label file paths when operating on files");

  const guidelines = guidelinesList.map((g) => `- ${g}`).join("\n");

  let prompt = "";
  prompt += `You are the writing assistant in catui. You help users by reading files, running commands, editing and writing text.

Available tools:
${toolsList}${extensionToolsList ? `\n${extensionToolsList}` : ""}

Besides the above tools, you may also have access to other custom tools based on project configuration.

Rules:
${guidelines}

## P3 Header and Progressive Disclosure

Each code file has a P3 format DIP header for quick relevance assessment:

[P3 Header Format Example]
/**
 * [WHO]: Provides {exported functions/components/types/constants}
 * [FROM]: Depends on {module/package/file} for {specific capability}
 * [TO]: Consumed by {adjacent modules or downstream consumers}
 * [HERE]: {file path} within {module}; relationship with neighbors}
 */

**Four Questions Meaning**:
- **WHO**: What does this file provide (exports, public API)
- **FROM**: What does this file depend on (upstream dependencies)
- **TO**: Who uses this file (downstream consumers)
- **HERE**: Where is this file, and what is its relationship with neighbors

**Header Reading Protocol**:

1. **Read header first**: When encountering a code file, read the P3 header first (usually first 5-8 lines)
2. **Assess relevance**:
   - If current task involves WHO (what provides), FROM (what depends), TO (who uses), HERE (where) declared in header → Continue reading
   - If not relevant → **Stop reading immediately**, save context
3. **Judgment criteria**:
   - Does your task need this file's WHO?
   - Is your task within this file's HERE scope?
   - Does your task depend on this file's FROM?

**Progressive Disclosure Context Savings**:
- Large projects may have hundreds of files
- Header is only 4 lines, while file may be hundreds of lines
- Read header = O(1), read full = O(n)
- Learning "header doesn't match then skip" is key to efficiency

**DIP Header Requirements When Generating Files**:
- Any created code file must include complete P3 header
- WHO must accurately describe exported public API (specific function/type names)
- FROM must list key dependencies
- TO must explain downstream consumers
- HERE must clarify module coordinates and upstream/downstream relationships

## catui.md Project Initialization Protocol

When first operating files in a project, check if \`catui.md\` (or \`AGENT.md\`, legacy \`CLAUDE.md\`) exists in root:

**If not exists**:
1. Suggest user create \`catui.md\`
2. Generate template content including:
   - Project overview (name, tech stack, core features)
   - Directory structure (P2 module list placeholder)
   - DIP protocol explanation (P3 header spec, progressive disclosure mindset)
   - Rules (code style, commit conventions, etc.)
3. Write file after user confirmation

**catui.md Template Structure**:

[catui.md Template Content]
# \${Project Name}

> P1 | Project root document and navigation map

## Project Overview
\${One sentence describing what the project is}

**Tech Stack**: \${List main technologies}
**Core Features**: \${2-3 sentences describing core capabilities}

## Directory Structure
\${P2 module list placeholder, to be filled by AI}

## DIP Protocol

This project uses **Dual-phase Isomorphic Documentation**:

- P1: Root document (this document), global topology
- P2: Module-level documents, member lists
- P3: File header comments, quick relevance judgment

See: https://catui.github.io/dip

## Rules
\${P0 code rules placeholder}

---
*This file is auto-generated by Catui, can be modified per project needs*

Only read the following docs when user asks about catui-agent, SDK, extensions, themes, skills or TUI:
- Main doc: ${readmePath}
- More docs: ${docsPath}
- Examples: ${examplesPath} (extensions, custom tools, SDK)
- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), skills (docs/skills.md), prompt templates (docs/prompt-templates.md), TUI components (docs/tui.md), keybindings (docs/keybindings.md), SDK integration (docs/sdk.md), custom providers (docs/custom-provider.md), adding models (docs/models.md), packages (docs/packages.md)
- When handling related topics, first read docs and examples, then implement following cross-references in .md files
- Must fully read .md files and follow related links (e.g., TUI API details in tui.md)`;

  if (soulSection) {
    prompt += `\n\n${soulSection}`;
  }

  // Inject persona identity before project context
  if (personaFiles.length > 0) {
    prompt += "\n\n# Your Identity\n\n";
    for (const { path: filePath, content } of personaFiles) {
      prompt += `${content}\n\n`;
    }
  }

  if (appendSection) {
    prompt += appendSection;
  }

  // Append project context files
  if (projectFiles.length > 0) {
    prompt += "\n\n# Project Context\n\n";
    prompt += "Project-related rules and specifications:\n\n";
    for (const { path: filePath, content } of projectFiles) {
      prompt += `## ${filePath}\n\n${content}\n\n`;
    }
  }

  // Append skills section (only when read tool is available)
  if (hasRead && skills.length > 0) {
    prompt += formatSkillsForPrompt(skills);
  }

  // Finally append date/time and working directory
  prompt += `\nCurrent date and time: ${dateTime}`;
  prompt += `\nCurrent working directory: ${resolvedCwd}`;

  prompt += timeReasoningInstruction;
  return prompt;
}
