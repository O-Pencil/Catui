/**
 * [WHO]: wrapSupervisedUI routes explicitly delegatable dialogs and captures notifications
 * [FROM]: Extension UI contracts and the session supervision service
 * [TO]: ExtensionRunner contexts; local dialogs remain the default
 * [HERE]: core/extensions-host/supervision-ui.ts - mode-independent decision adapter
 */
import type { SessionSupervision } from "./supervision.js";
import type { ExtensionUIContext } from "./types.js";

export function wrapSupervisedUI(ui: ExtensionUIContext, supervision: SessionSupervision): ExtensionUIContext {
  return {
    ...ui,
    notify: (message, level = "info") => { supervision.notify(message, level); ui.notify(message, level); },
    select: (title, options, opts) => supervision.active && opts?.delegatable
      ? supervision.request({ kind: "select", title, options }, opts.signal) as Promise<string>
      : ui.select(title, options, opts),
    confirm: (title, message, opts) => supervision.active && opts?.delegatable
      ? supervision.request({ kind: "confirm", title, detail: message }, opts.signal) as Promise<boolean>
      : ui.confirm(title, message, opts),
    input: (title, placeholder, opts) => supervision.active && opts?.delegatable
      ? supervision.request({ kind: "input", title, detail: placeholder }, opts.signal) as Promise<string>
      : ui.input(title, placeholder, opts),
  };
}
