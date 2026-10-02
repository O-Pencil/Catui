/**
 * [WHO]: Provides SoulOptionsContract for legacy SDK compatibility
 * [FROM]: No runtime dependencies; pure option contract
 * [TO]: Consumed by core/runtime/sdk.ts
 * [HERE]: core/soul-options-contract.ts - contract seam that keeps Soul integration independent from SDK options
 */

export interface SoulOptionsContract {
  /** @deprecated NanoSoul is suspended. This option is ignored; use persona. */
  enableSoul?: boolean;
}
