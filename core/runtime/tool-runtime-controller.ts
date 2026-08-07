/**
 * [WHO]: Provides ToolRuntimeController, ToolRuntimeBuildOptions, ToolRuntimeBuildResult
 * [FROM]: Depends on agent-core tool types, extensions-host wrappers, and ToolOrchestrator
 * [TO]: Consumed by core/runtime/agent-session.ts during runtime rebuilds and tool activation
 * [HERE]: core/runtime/tool-runtime-controller.ts - tool source merge, wrapping, active resolution
 *
 * Extracted from AgentSession (AS05). AgentSession still owns extension lifecycle and prompt
 * application; this controller owns the tool runtime policy that determines which tools exist
 * and which tools are active after a rebuild.
 */

import type { AgentTool } from "@catui/agent-core";
import type { ExtensionRunner } from "../extensions-host/runner.js";
import type {
  RegisteredTool,
  ToolDefinition,
} from "../extensions-host/types.js";
import {
  wrapRegisteredTools,
  wrapToolsWithExtensions,
} from "../extensions-host/wrapper.js";
import type { ToolOrchestrator } from "../tools/orchestrator.js";

export interface ToolRuntimeBuildOptions {
  baseTools: Map<string, AgentTool>;
  baseToolsOverride?: Record<string, AgentTool>;
  customTools: ToolDefinition[];
  activeToolNames?: string[];
  includeAllExtensionTools?: boolean;
  extensionRunner?: ExtensionRunner;
}

export interface ToolRuntimeBuildResult {
  activeTools: AgentTool[];
  systemPromptToolNames: string[];
}

export class ToolRuntimeController {
  constructor(private readonly orchestrator: ToolOrchestrator) {}

  build(options: ToolRuntimeBuildOptions): ToolRuntimeBuildResult {
    const wrappedExtensionTools = this._buildExtensionTools(
      options.extensionRunner,
      options.customTools,
    );

    const allTools = [
      ...options.baseTools.values(),
      ...wrappedExtensionTools,
    ];

    const activeToolNameSet = this._resolveActiveToolNames(
      options.baseToolsOverride,
      options.activeToolNames,
      wrappedExtensionTools,
      options.includeAllExtensionTools,
    );
    const activeTools = this._resolveActiveTools(
      activeToolNameSet,
      options.baseTools,
      wrappedExtensionTools,
    );

    if (options.extensionRunner) {
      const wrappedAllTools = wrapToolsWithExtensions(
        allTools,
        options.extensionRunner,
      ) as AgentTool[];
      const activeToolNames = activeTools.map((tool) => tool.name);
      this.orchestrator.replaceTools(
        wrappedAllTools,
        activeToolNames,
      );
      this.orchestrator.setCustomTools(options.customTools);
      return {
        activeTools: this.orchestrator.setActiveToolsByName(activeToolNames).tools,
        systemPromptToolNames: this._systemPromptToolNames(
          activeToolNameSet,
          options.baseTools,
        ),
      };
    }

    this.orchestrator.replaceTools(
      allTools,
      activeTools.map((tool) => tool.name),
    );
    this.orchestrator.setCustomTools(options.customTools);
    return {
      activeTools: this.orchestrator.setActiveToolsByName(
        activeTools.map((tool) => tool.name),
      ).tools,
      systemPromptToolNames: this._systemPromptToolNames(
        activeToolNameSet,
        options.baseTools,
      ),
    };
  }

  private _buildExtensionTools(
    extensionRunner: ExtensionRunner | undefined,
    customTools: ToolDefinition[],
  ): AgentTool[] {
    if (!extensionRunner) {
      return [];
    }

    const registeredTools = extensionRunner.getAllRegisteredTools();
    const allCustomTools: RegisteredTool[] = [
      ...registeredTools,
      ...customTools.map((definition) => ({
        definition,
        extensionPath: "<sdk>",
      })),
    ];
    return wrapRegisteredTools(allCustomTools, extensionRunner) as AgentTool[];
  }

  private _resolveActiveToolNames(
    baseToolsOverride: Record<string, AgentTool> | undefined,
    activeToolNames: string[] | undefined,
    wrappedExtensionTools: AgentTool[],
    includeAllExtensionTools: boolean | undefined,
  ): Set<string> {
    const defaultActiveToolNames = baseToolsOverride
      ? Object.keys(baseToolsOverride)
      : ["read", "bash", "edit", "write", "time"];
    const activeToolNameSet = new Set<string>(
      activeToolNames ?? defaultActiveToolNames,
    );
    if (includeAllExtensionTools) {
      for (const tool of wrappedExtensionTools) {
        activeToolNameSet.add(tool.name);
      }
    }
    return activeToolNameSet;
  }

  private _resolveActiveTools(
    activeToolNameSet: Set<string>,
    baseTools: Map<string, AgentTool>,
    wrappedExtensionTools: AgentTool[],
  ): AgentTool[] {
    const extensionToolNames = new Set(
      wrappedExtensionTools.map((tool) => tool.name),
    );
    const activeBaseTools = Array.from(activeToolNameSet)
      .filter((name) => baseTools.has(name) && !extensionToolNames.has(name))
      .map((name) => baseTools.get(name) as AgentTool);
    const activeExtensionTools = wrappedExtensionTools.filter((tool) =>
      activeToolNameSet.has(tool.name),
    );
    return [...activeBaseTools, ...activeExtensionTools];
  }

  private _systemPromptToolNames(
    activeToolNameSet: Set<string>,
    baseTools: Map<string, AgentTool>,
  ): string[] {
    return Array.from(activeToolNameSet).filter((name) => baseTools.has(name));
  }
}
