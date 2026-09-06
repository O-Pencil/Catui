/**
 * [WHO]: Provides BuddyPetController + BuddyPetContext — desktop-pet lifecycle
 *        (syncBuddyPet enable/species handling, setBuddyPetState with reset timer)
 * [FROM]: Depends on injected host capability closures + BuddyPetComponent;
 *         no InteractiveMode reference
 * [TO]: Consumed by modes/interactive/interactive-mode.ts (held lazily as `this.buddyPetHost`
 *       behind thin delegators: syncBuddyPet / setBuddyPetState)
 * [HERE]: modes/interactive/controllers/buddy-pet-controller.ts — P7 C-3d (extracted from
 *         InteractiveMode; behavior-preserving move)
 */
import type { Container, TUI } from "@catui/tui";
import type { SettingsManager } from "../../../core/platform/config/settings-manager.js";
import { BuddyPetComponent, type BuddyState } from "../components/buddy/pet-sprites.js";

/** Host capabilities needed by the buddy-pet controller. */
export interface BuddyPetContext {
  readonly settingsManager: SettingsManager;
  readonly buddySlot: Container;
  readonly ui: TUI;
  renderWidgets(): void;
  requestRender(): void;
}

export class BuddyPetController {
  private pet: BuddyPetComponent | null = null;
  private species: number | null = null;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly ctx: BuddyPetContext) {}

  /** Stop the pet and cancel any pending reset timer (shutdown path). */
  dispose(): void {
    this.clearBuddyPetResetTimer();
    this.pet?.dispose();
    this.pet = null;
  }

  private clearBuddyPetResetTimer(): void {
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = undefined;
    }
  }

  syncBuddyPet(): void {
    const enabled = this.ctx.settingsManager.getBuddyEnabled();
    const species = this.ctx.settingsManager.getBuddySpecies();

    if (!enabled) {
      this.clearBuddyPetResetTimer();
      this.pet?.dispose();
      this.pet = null;
      this.species = null;
      this.ctx.buddySlot.clear();
      this.ctx.renderWidgets();
      return;
    }

    if (!this.pet || this.species !== species) {
      this.clearBuddyPetResetTimer();
      this.pet?.dispose();
      this.pet = new BuddyPetComponent(this.ctx.ui, species);
      this.species = species;
      this.pet.setState("idle");
      this.pet.setSpeechBubble("");
    }

    this.ctx.buddySlot.clear();
    this.ctx.buddySlot.addChild(this.pet);
    this.ctx.renderWidgets();
  }

  setBuddyPetState(
    state: BuddyState,
    speechBubble = "",
    options?: { resetTo?: BuddyState; afterMs?: number },
  ): void {
    if (!this.pet) return;

    this.clearBuddyPetResetTimer();
    this.pet.setState(state);
    this.pet.setSpeechBubble(speechBubble);

    if (options?.resetTo) {
      this.resetTimer = setTimeout(() => {
        if (!this.pet) return;
        this.pet.setState(options.resetTo ?? "idle");
        this.pet.setSpeechBubble("");
        this.resetTimer = undefined;
        this.ctx.requestRender();
      }, options.afterMs ?? 1500);
    }

    this.ctx.requestRender();
  }
}
