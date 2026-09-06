# PawBench Cron Transcript Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Project Catui `CronCreate` trace inputs into PawBench's grader-facing cron argument vocabulary without changing Catui's native tool or trace contracts.

**Architecture:** Add one pure, create-only argument normalizer in PawBench's Catui adapter and call it during trace extraction before the existing tool-name mapping. The projection copies input, renames `cron` to `schedule`, and supplies Catui print mode's fixed console/default delivery semantics. Other tools and malformed inputs pass through unchanged.

**Tech Stack:** Python 3.11+, pytest, PawBench `ContainerAgent`, Catui JSONL run traces

---

## Preconditions and File Map

The PawBench repository is outside the Catui writable workspace and requires explicit approved write access during execution.

The PawBench worktree already has unrelated user changes. In particular, `pawbench/agents/impl/catui_agent.py` is currently untracked and must be preserved as the implementation baseline. Do not stage `pawbench/agents/factory.py`, `pawbench/grader.py`, `run_bench.py`, reports, results, or `.catui/` data.

- Modify: `/Users/cunyu666/Dev/PawBench/pawbench/agents/impl/catui_agent.py` — pure argument normalization plus extraction wiring.
- Create: `/Users/cunyu666/Dev/PawBench/tests/test_catui_agent.py` — unit and synthetic trace coverage.

### Task 1: Add Failing Adapter and Transcript Tests

**Files:**
- Create: `/Users/cunyu666/Dev/PawBench/tests/test_catui_agent.py`

- [ ] **Step 1: Create the focused test module**

Create `tests/test_catui_agent.py` with:

```python
# -*- coding: utf-8 -*-
"""Tests for Catui-to-PawBench transcript compatibility."""

from __future__ import annotations

import json
from copy import deepcopy

from pawbench.agents.impl import catui_agent
from pawbench.agents.impl.catui_agent import CatuiAgent


def test_cron_create_arguments_are_projected_without_mutating_input() -> None:
    arguments = {
        "cron": "0 18 * * *",
        "prompt": "Study English",
        "recurring": True,
    }
    original = deepcopy(arguments)

    normalized = catui_agent._normalize_tool_arguments("CronCreate", arguments)

    assert normalized == {
        "schedule": "0 18 * * *",
        "prompt": "Study English",
        "recurring": True,
        "channel": "console",
        "target-user": "default",
        "target-session": "default",
    }
    assert arguments == original


def test_cron_create_ignores_unsupported_compatible_fields() -> None:
    normalized = catui_agent._normalize_tool_arguments(
        "CronCreate",
        {
            "cron": "0 18 * * *",
            "schedule": "0 17 * * 5",
            "prompt": "Write weekly report",
            "channel": "terminal",
            "target-user": "reviewer",
            "target-session": "weekly",
        },
    )

    assert normalized["schedule"] == "0 18 * * *"
    assert normalized["channel"] == "console"
    assert normalized["target-user"] == "default"
    assert normalized["target-session"] == "default"
    assert "cron" not in normalized


def test_non_create_and_non_dictionary_arguments_pass_through() -> None:
    delete_arguments = {"id": "job-1"}
    scalar_arguments = "unexpected"

    assert catui_agent._normalize_tool_arguments("CronDelete", delete_arguments) is delete_arguments
    assert catui_agent._normalize_tool_arguments("bash", {"command": "pwd"}) == {"command": "pwd"}
    assert catui_agent._normalize_tool_arguments("CronCreate", scalar_arguments) is scalar_arguments


def test_extract_transcript_normalizes_a_synthetic_cron_create_trace(tmp_path) -> None:
    trace_dir = tmp_path / ".catui" / "traces"
    trace_dir.mkdir(parents=True)
    (tmp_path / "task_prompt.md").write_text("Schedule an English reminder", encoding="utf-8")
    entries = [
        {
            "kind": "tool.requested",
            "payload": {
                "toolName": "CronCreate",
                "toolCallId": "cron-1",
                "input": {
                    "cron": "0 18 * * *",
                    "prompt": "Study English",
                    "recurring": True,
                },
            },
        },
        {
            "kind": "tool.completed",
            "payload": {
                "toolCallId": "cron-1",
                "outcome": "success",
            },
        },
    ]
    (trace_dir / "latest.jsonl").write_text(
        "\n".join(json.dumps(entry) for entry in entries) + "\n",
        encoding="utf-8",
    )

    transcript = CatuiAgent().extract_transcript(tmp_path, "done")
    tool_calls = [
        part
        for event in transcript
        for part in event.get("message", {}).get("content", [])
        if part.get("type") == "toolCall"
    ]

    assert tool_calls == [
        {
            "type": "toolCall",
            "name": "cron",
            "arguments": {
                "schedule": "0 18 * * *",
                "prompt": "Study English",
                "recurring": True,
                "channel": "console",
                "target-user": "default",
                "target-session": "default",
            },
        }
    ]
```

- [ ] **Step 2: Run the focused test and verify RED**

From `/Users/cunyu666/Dev/PawBench`, run:

```bash
python3 -m pytest tests/test_catui_agent.py -q
```

Expected: the three direct helper tests fail with `AttributeError` because `_normalize_tool_arguments` does not exist, and the synthetic transcript assertion fails because extraction still emits native cron arguments. Resolve only unrelated environmental import errors before recording RED; do not implement the helper before these intended failures are observed.

### Task 2: Implement Create-Only Argument Normalization

**Files:**
- Modify: `/Users/cunyu666/Dev/PawBench/pawbench/agents/impl/catui_agent.py`
- Test: `/Users/cunyu666/Dev/PawBench/tests/test_catui_agent.py`

- [ ] **Step 1: Add the pure normalizer after `_map_tool_name`**

```python
def _normalize_tool_arguments(catui_name: str, arguments: Any) -> Any:
    """Project Catui tool arguments into PawBench's grader vocabulary."""
    if catui_name != "CronCreate" or not isinstance(arguments, dict):
        return arguments

    normalized = dict(arguments)
    cron = normalized.pop("cron", None)
    normalized.pop("schedule", None)
    if cron is not None:
        normalized["schedule"] = cron
    normalized["channel"] = "console"
    normalized["target-user"] = "default"
    normalized["target-session"] = "default"
    return normalized
```

The adapter already imports `Any`, so no new dependency or import is needed.

- [ ] **Step 2: Wire normalization into trace extraction**

In the `for te in tool_events` block, replace:

```python
tool_input = te.get("input", {})
is_error = te.get("outcome", "success") != "success"
# Map catui tool names to expected grader names
mapped_name = _map_tool_name(tool_name)
```

with:

```python
tool_input = te.get("input", {})
normalized_input = _normalize_tool_arguments(tool_name, tool_input)
is_error = te.get("outcome", "success") != "success"
# Map catui tool names to expected grader names
mapped_name = _map_tool_name(tool_name)
```

Then replace the tool-call argument expression:

```python
"arguments": tool_input if tool_input else {"_tool": tool_name},
```

with:

```python
"arguments": normalized_input if normalized_input else {"_tool": tool_name},
```

- [ ] **Step 3: Run the focused tests and verify GREEN**

From `/Users/cunyu666/Dev/PawBench`, run:

```bash
python3 -m pytest tests/test_catui_agent.py -q
```

Expected: all four tests pass.

- [ ] **Step 4: Run a fresh mutation guard check**

Temporarily change the implementation from `normalized = dict(arguments)` to `normalized = arguments`, run:

```bash
python3 -m pytest tests/test_catui_agent.py::test_cron_create_arguments_are_projected_without_mutating_input -q
```

Expected: FAIL because the original dictionary loses `cron` and gains projected fields. Restore `normalized = dict(arguments)` and rerun the same command.

Expected after restoration: PASS. This proves the regression test detects in-place mutation rather than merely exercising the helper.

### Task 3: Verify and Commit Only the PawBench Adapter Slice

**Files:**
- Verify: `/Users/cunyu666/Dev/PawBench/pawbench/agents/impl/catui_agent.py`
- Verify: `/Users/cunyu666/Dev/PawBench/tests/test_catui_agent.py`

- [ ] **Step 1: Run focused verification**

From `/Users/cunyu666/Dev/PawBench`, run:

```bash
python3 -m pytest tests/test_catui_agent.py -q
python3 -c 'from pathlib import Path; paths=["pawbench/agents/impl/catui_agent.py", "tests/test_catui_agent.py"]; [compile(Path(path).read_text(encoding="utf-8"), path, "exec") for path in paths]'
```

Expected: pytest exits 0 with four passing tests; the in-memory syntax compilation exits 0 without creating bytecode files.

- [ ] **Step 2: Inspect repository state and exact files**

Run:

```bash
git status --short
```

Because both target files may be untracked before staging, also inspect them directly:

```bash
sed -n '1,260p' pawbench/agents/impl/catui_agent.py
sed -n '1,260p' tests/test_catui_agent.py
```

Expected: the helper and its single extraction call site match the plan; no unrelated PawBench file is staged.

- [ ] **Step 3: Commit only the adapter and its test**

```bash
git add pawbench/agents/impl/catui_agent.py tests/test_catui_agent.py
git diff --cached --check
git diff --cached --name-only
git status --short
git commit -m "fix(catui): normalize cron transcript arguments"
```

Before committing, verify `git diff --cached --name-only` contains exactly those two paths. Existing modifications to factory, grader, runner, reports, and result data remain unstaged.

### Task 4: Record Cross-Repository Acceptance

**Files:**
- Verify only; do not modify Catui or PawBench production files.

- [ ] **Step 1: Re-run the synthetic trace test after the commit**

```bash
cd /Users/cunyu666/Dev/PawBench
python3 -m pytest tests/test_catui_agent.py::test_extract_transcript_normalizes_a_synthetic_cron_create_trace -q
```

Expected: one passing test.

- [ ] **Step 2: Confirm native Catui contracts did not change**

From `/Users/cunyu666/Dev/catui`, run:

```bash
git diff e881a08..HEAD -- extensions/builtin/loop/cron-tools/cron-create-tool.ts core/runtime/run-trace-jsonl.ts
```

Expected: no diff. Commit `e881a08` is the approved design baseline for this work.

- [ ] **Step 3: Report deterministic and non-deterministic outcomes separately**

The handoff must report:

- deterministic evidence: focused PawBench tests and synthetic transcript smoke pass;
- expected effect: cron parameter scoring can now observe schedule and fixed delivery semantics;
- unresolved benchmark work: no skill installation or named Agent creation event is synthesized;
- excluded work: no 429 change, vision-model configuration, or full 150-task run.
