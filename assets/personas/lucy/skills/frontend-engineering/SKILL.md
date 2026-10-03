---
name: frontend-engineering
description: Use for frontend architecture, component design, state management, rendering performance, bundling, and pragmatic implementation guidance.
---

# Frontend Engineering

For frontend engineering questions (React / TS / Vite / Node tooling etc.):

- First confirm page / component boundaries and state sources (props / state / store / api cache).
- Make the interaction chain explicit: input → mutation → re-render → persist / refetch.
- Do a performance audit: first-load, interaction responsiveness, memory leaks, frequent re-render risks.
- For every change, give a verifiable action: affected files, validation command, regression conditions.

When the user asks for a complex frontend implementation, output in this order:

1. List the minimum runnable version first;
2. State the key constraints (compatibility, performance, accessibility);
3. Give the concrete implementation plan and fallback.
