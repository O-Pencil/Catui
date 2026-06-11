/**
 * [WHO]: Provides InputSubmitController + InputSubmitContext — editor submit pipeline orchestration
 * [FROM]: Depends on @pencil-agent/ai content types, AgentSession prompt options, image pipeline attachment type
 * [TO]: Consumed by modes/interactive/interactive-mode.ts as the default editor onSubmit handler
 * [HERE]: modes/interactive/controllers/input-submit-controller.ts — P5 input-submit slice (UI06, rewrite)
 *
 * Owns submit classification and ordering only. Slash dispatch, image/attachment processing, bash execution,
 * session prompt/steer, and rendering details are delegated through ports.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ImageContent, Model, TextContent } from "@pencil-agent/ai/types";
import type { PromptOptions } from "../../../core/runtime/agent-session.js";
import type { Attachment } from "./image-pipeline-controller.js";

type AnyModel = Model<any>;

const debugLogPath = path.join(os.homedir(), ".nanopencil", "agent", "nanopencil-debug.log");
function dbg(msg: string): void {
	fs.appendFileSync(debugLogPath, `[${new Date().toISOString()}] [submit] ${msg}\n`);
}

export interface InputSubmitEditorPort {
  setText(text: string): void;
  addToHistory(text: string): void;
  handleExternalInput(text: string): boolean;
  setBashMode(enabled: boolean): void;
  updateBorderColor(): void;
}

export interface InputSubmitSlashPort {
  execute(text: string): Promise<boolean>;
}

export interface InputSubmitImagePort {
  awaitPendingPaste(): Promise<void>;
  extractImagesFromText(text: string): Promise<{
    text: string;
    images: ImageContent[];
  }>;
  takePendingAttachments(): Attachment[];
  processAttachmentFiles(attachments: Attachment[]): Promise<ImageContent[]>;
  cleanupClipboardImages(): void;
}

export interface InputSubmitSessionPort {
  isBashRunning(): boolean;
  isCompacting(): boolean;
  isStreaming(): boolean;
  getModel(): AnyModel | undefined;
  getCwd(): string;
  promptAfterRender(text: string, options?: PromptOptions): Promise<void>;
  queueCompactionMessage(text: string, mode: "steer" | "followUp"): void;
}

export interface InputSubmitCommandPort {
  isExtensionCommand(text: string): boolean;
  handlePersonaCommand(text: string): Promise<void>;
  handleBashCommand(command: string, excludeFromContext: boolean): Promise<void>;
}

export interface InputSubmitRenderPort {
  showStatus(message: string): void;
  showWarning(message: string): void;
  showError(message: string): void;
  notify(message: string, options?: { key?: string; priority?: "immediate" | "high" | "medium" | "low"; type?: "info" | "warning" | "error"; duration?: number }): void;
  requestRender(): void;
  flushPendingBashComponents(): void;
  updatePendingMessagesDisplay(): void;
  addOptimisticUserMessage(
    text: string,
    content: Array<TextContent | ImageContent>,
  ): void;
  rollbackFirstOptimisticUserMessageIfMatches(text: string): void;
}

export interface InputSubmitContext {
  editor: InputSubmitEditorPort;
  slash: InputSubmitSlashPort;
  image: InputSubmitImagePort;
  session: InputSubmitSessionPort;
  commands: InputSubmitCommandPort;
  render: InputSubmitRenderPort;
}

export class InputSubmitController {
  constructor(private readonly ctx: InputSubmitContext) {}

  async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    if (!text) return;
    dbg(`handleSubmit: "${text.slice(0, 80)}"`);

    await this.ctx.image.awaitPendingPaste();

    if (await this.ctx.slash.execute(text)) {
      dbg(`handleSubmit → built-in slash handled`);
      return;
    }

    const personaMatch = text.match(/\s+\/persona\b/);
    if (personaMatch) {
      const personaCmd = text.slice(personaMatch.index! + 1);
      const remainingText = text.slice(0, personaMatch.index!).trim();

      this.ctx.editor.setText("");
      await this.ctx.commands.handlePersonaCommand(personaCmd);

      if (remainingText) {
        await this.ctx.session.promptAfterRender(remainingText);
      }
      return;
    }

    if (text.startsWith("!")) {
      const isExcluded = text.startsWith("!!");
      const command = isExcluded ? text.slice(2).trim() : text.slice(1).trim();
      if (command) {
        if (this.ctx.session.isBashRunning()) {
          this.ctx.render.showWarning(
            "A bash command is already running. Press Esc to cancel it first.",
          );
          this.ctx.editor.setText(text);
          return;
        }
        this.ctx.editor.addToHistory(text);
        await this.ctx.commands.handleBashCommand(command, isExcluded);
        this.ctx.editor.setBashMode(false);
        this.ctx.editor.updateBorderColor();
        return;
      }
    }

    if (this.ctx.session.isCompacting()) {
      if (this.ctx.commands.isExtensionCommand(text)) {
        this.ctx.editor.addToHistory(text);
        this.ctx.editor.setText("");
        await this.ctx.session.promptAfterRender(text);
      } else {
        this.ctx.session.queueCompactionMessage(text, "steer");
      }
      return;
    }

    if (this.ctx.session.isStreaming()) {
      await this.handleStreamingSubmit(text);
      return;
    }

    await this.handleIdleSubmit(text);
  }

  private async handleStreamingSubmit(text: string): Promise<void> {
    this.ctx.editor.addToHistory(text);
    this.ctx.editor.setText("");

    const displayContent: Array<TextContent | ImageContent> = [
      { type: "text", text },
    ];
    this.ctx.render.addOptimisticUserMessage(text, displayContent);
    this.ctx.render.requestRender();

    const steerResult = await this.ctx.image.extractImagesFromText(text);
    const steerImages = steerResult.images;
    let steerAttachmentPaths: string[] = [];
    const steerPendingAttachments = this.ctx.image.takePendingAttachments();
    if (steerPendingAttachments.length > 0) {
      steerAttachmentPaths = steerPendingAttachments.map((a) => a.path);
    }

    const steerModel = this.ctx.session.getModel();
    if (
      (steerImages.length > 0 || steerAttachmentPaths.length > 0) &&
      steerModel &&
      !steerModel.input.includes("image")
    ) {
      steerImages.length = 0;
      steerAttachmentPaths = [];
      this.ctx.render.showStatus(
        `Images dropped: ${steerModel.name} does not support images.${this.imageSupportSuggestion(steerModel, false)}`,
      );
      this.ctx.render.requestRender();
    }

    let steerPromptText = steerResult.text;
    if (steerAttachmentPaths.length > 0) {
      const cwd = this.ctx.session.getCwd();
      const refs = steerAttachmentPaths
        .map((p) => `@${path.relative(cwd, p).replace(/\\/g, "/")}`)
        .join(" ");
      steerPromptText = refs + "  " + steerPromptText;
    }

    await this.ctx.session.promptAfterRender(steerPromptText, {
      streamingBehavior: "steer",
      images: steerImages.length > 0 ? steerImages : undefined,
    });
    this.ctx.render.updatePendingMessagesDisplay();
    this.ctx.render.requestRender();
  }

  private async handleIdleSubmit(text: string): Promise<void> {
    dbg(`handleIdleSubmit: "${text.slice(0, 80)}"`);
    this.ctx.render.flushPendingBashComponents();

    this.ctx.editor.addToHistory(text);
    this.ctx.editor.setText("");

    const { text: processedText, images } =
      await this.ctx.image.extractImagesFromText(text);

    const pendingAttachments = this.ctx.image.takePendingAttachments();
    if (pendingAttachments.length > 0) {
      const inlineImages =
        await this.ctx.image.processAttachmentFiles(pendingAttachments);
      images.push(...inlineImages);
    }

    if (images.length > 0) {
      const currentModel = this.ctx.session.getModel();
      if (currentModel && !currentModel.input.includes("image")) {
        this.ctx.render.showWarning(
          `Model "${currentModel.name}" does not support image input. Images have been removed from this message.${this.imageSupportSuggestion(currentModel, true)}`,
        );
        images.length = 0;
      }
    }

    // Show the user's input in the chat immediately (optimistic echo).
    // Built-in slash commands never reach here (handled by slash.execute above),
    // so this only applies to extension commands and regular messages.
    // Skip optimistic message for extension commands — they handle their own
    // UI and may internally call sendUserMessage, which would cause double display.
    const isExtensionCmd = this.ctx.commands.isExtensionCommand(processedText);
    if (!isExtensionCmd) {
      const displayContent: Array<TextContent | ImageContent> = [
        { type: "text", text: processedText },
      ];
      if (images.length > 0) {
        displayContent.push(...images);
      }
      this.ctx.render.addOptimisticUserMessage(processedText, displayContent);
      this.ctx.render.requestRender();
      dbg("handleIdleSubmit → optimistic message added");
    } else {
      dbg("handleIdleSubmit → skipping optimistic message for extension command");
    }

    // If the main interactive loop is waiting for input (getUserInput),
    // hand off the text to it — the loop will call session.prompt() directly.
    // We still return here because promptAfterRender would deadlock (it waits
    // for a render that the main loop's session.prompt will trigger).
    if (this.ctx.editor.handleExternalInput(text)) {
      dbg("handleIdleSubmit → handed off to main loop via handleExternalInput");
      return;
    }

    try {
      delete process.env.NANOPENCIL_JUST_SWITCHED_PERSONA;
      await this.ctx.session.promptAfterRender(processedText, {
        images: images.length > 0 ? images : undefined,
      });
      dbg("handleIdleSubmit → promptAfterRender returned normally");
    } catch (error: unknown) {
      dbg(`handleIdleSubmit → promptAfterRender threw: ${error}`);
      this.ctx.render.rollbackFirstOptimisticUserMessageIfMatches(
        processedText,
      );
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error occurred";
      this.ctx.render.showError(errorMessage);
    }
    this.ctx.render.updatePendingMessagesDisplay();
    this.ctx.render.requestRender();

    this.ctx.image.cleanupClipboardImages();
  }

  private imageSupportSuggestion(model: AnyModel, includeUsing: boolean): string {
    const prefix = includeUsing ? " Try using" : " Try";
    if (model.id === "glm-5" || model.id === "glm-5-turbo") {
      return `${prefix} glm-5v-turbo for image support.`;
    }
    if (model.id === "glm-4.5" || model.id === "glm-4.5-air") {
      return `${prefix} glm-4.5v for image support.`;
    }
    return "";
  }
}
