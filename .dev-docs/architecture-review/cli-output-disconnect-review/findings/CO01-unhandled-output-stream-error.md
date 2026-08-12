# CO01 — Unhandled output-stream errors cross the CLI boundary

## Evidence

Node emits asynchronous write failures on the writable stream as `error`
events. `cli.ts` writes in its fast paths before importing the application, and
neither the CLI entry nor the modes install an error listener. If the terminal,
PTY, or pipe consumer closes, `EPIPE` is therefore an unhandled event and Node
terminates with a stack trace.

The 1.2.12 code delta did not change the CLI, TUI, stdout, stderr, or socket
handling. Its expanded evolution output exposed the pre-existing process-boundary
gap rather than introducing a new stream writer.

## Resolution

Install one shared output-disconnect guard for stdout and stderr at the start of
the CLI entry. It absorbs only expected closed-consumer codes and rethrows all
other errors. This keeps the policy at the narrowest common owner and prevents
duplicated mode-specific handling.
