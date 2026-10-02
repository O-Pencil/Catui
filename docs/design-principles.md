# Catui design principles

Catui is a terminal-first coding agent with persistent project memory, selectable
personas and extensible workflows. The [repository map](../AGENTS.md) describes
the current module boundaries; this guide explains the choices behind them.

## Keep session orchestration separate from product behavior

`AgentSession` exposes the shared lifecycle used by interactive, print, RPC, ACP
and remote modes. Focused runtime owners handle message queues, events, traces,
queries and extension resources. User-visible workflows belong in extensions;
they consume the extension API instead of creating competing session state.

## Make tool work inspectable

Use the available evidence to choose a useful action, supply grounded tool
arguments, inspect the result and revise the approach when progress stalls.
Default decision skills teach this loop; tool policies, traces and evaluation
fixtures provide separate runtime controls. Prompt guidance alone does not prove
correctness or improved model performance.

## Keep identity explicit and storage local

Personas define the selected identity and working style. NanoMem retains project
knowledge. NanoSoul's automatic personality evolution is suspended in the host.
Sessions and settings persist locally; configured models and external tools may
still send requests to their providers.

## Keep interfaces small and changes verifiable

The private `@catui/ai`, `@catui/agent-core` and `@catui/tui` libraries own model
transport, the agent loop and terminal primitives. Public integration contracts
belong in `catui-protocol` only when they cross a publishing boundary. Types stay
in the narrowest useful scope. Module maps and source headers document ownership.

Changes pass the [feature workflow](../.dev-docs/feature-workflow.md), including
dependency boundaries, documentation checks, build and type checks. Add targeted
behavioral verification when a change affects observable behavior.

## Provenance

Catui builds on earlier open-source work, including the
[pi project](https://github.com/earendil-works/pi). Its private runtime libraries
and parts of the host have upstream lineage. Current names and subsequent
changes do not erase that origin. Retain applicable third-party notices and
licenses; historical architecture reviews retain their source citations.
