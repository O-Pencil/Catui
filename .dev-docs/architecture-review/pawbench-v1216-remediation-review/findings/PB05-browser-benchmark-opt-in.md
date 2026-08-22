# PB05 Browser Benchmark Opt-In

## Phenomenon

PawBench GUI tasks need a browser automation tool to be registered in non-interactive runs. In Catui v1.2.16 the Browser Harness extension is present but opt-in, so default benchmark runs can miss browser-capable tool selection.

## Essence

Browser Harness is not a passive capability: it can spawn Python subprocesses, attach to local Chrome/Edge through CDP, and seed a global helper workspace. Making it default-on would change the product security and side-effect boundary for every user.

The benchmark failure is therefore a configuration-surface problem, not proof that browser automation should move into the normal default extension set.

## Decision

Keep `browser` metadata as `category: "optional"` and `defaultEnabled: false`, but allow benchmark/CI harnesses to register it through:

```bash
CATUI_ENABLE_BROWSER_EXTENSION=1
```

This adds the Browser Harness extension path to `getBuiltinExtensionPaths()` for that process only. It does not mutate user config, and it keeps normal startup defaults unchanged.

## Verification

- Default path test asserts Browser Harness remains absent without the env opt-in.
- Env path test asserts Browser Harness is present when `CATUI_ENABLE_BROWSER_EXTENSION=1`.
