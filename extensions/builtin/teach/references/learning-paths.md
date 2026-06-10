# Learning Paths

Structured curricula for learners at different levels.
Each path is a recommended sequence of topics that build on each other.

---

## Path A: Foundations (L0 → L1)

For learners with zero knowledge who want to understand the basics.

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| A1 | What is this field? | 5 min | — |
| A2 | Core concepts | 10 min | A1 |
| A3 | Basic terminology | 10 min | A2 |
| A4 | Simple applications | 15 min | A3 |
| A5 | Common patterns | 15 min | A4 |
| A6 | Putting it together | 15 min | A1-A5 |

**Total**: ~70 minutes across multiple sessions. Recommend 1-2 topics per day.

### Example: Learning Cooking

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| A1 | What is cooking? | 5 min | — |
| A2 | Essential tools | 10 min | A1 |
| A3 | Basic techniques | 10 min | A2 |
| A4 | Simple recipes | 15 min | A3 |
| A5 | Flavor combinations | 15 min | A4 |
| A6 | First complete meal | 15 min | A1-A5 |

---

## Path B: Practical Skills (L1 → L2)

For learners who know basics and want to apply knowledge practically.

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| B1 | Real-world scenarios | 15 min | A* |
| B2 | Problem-solving patterns | 15 min | B1 |
| B3 | Tools and techniques | 15 min | B2 |
| B4 | Best practices | 20 min | B3 |
| B5 | Common mistakes | 10 min | B4 |
| B6 | Hands-on practice | 20 min | B1-B5 |

**Total**: ~95 minutes across multiple sessions.

### Example: Cooking Intermediate

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| B1 | Meal planning | 15 min | A* |
| B2 | Ingredient selection | 15 min | B1 |
| B3 | Advanced techniques | 15 min | B2 |
| B4 | Kitchen efficiency | 20 min | B3 |
| B5 | Troubleshooting dishes | 10 min | B4 |
| B6 | Cooking for others | 20 min | B1-B5 |

---

## Path C: Deep Understanding (L2 → L3)

For advanced learners who want to understand system-level decisions.

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| C1 | Advanced concepts | 20 min | B* |
| C2 | Architecture patterns | 15 min | C1 |
| C3 | Performance considerations | 15 min | C2 |
| C4 | Trade-offs and decisions | 15 min | C3 |
| C5 | Industry trends | 20 min | C4 |
| C6 | Expert techniques | 20 min | C1-C5 |

**Total**: ~105 minutes across multiple sessions.

### Example: Cooking Advanced

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| C1 | Cuisine theory | 20 min | B* |
| C2 | Menu design | 15 min | C1 |
| C3 | Nutrition science | 15 min | C2 |
| C4 | Cost optimization | 15 min | C3 |
| C5 | Food trends | 20 min | C4 |
| C6 | Restaurant techniques | 20 min | C1-C5 |

---

## How to Use

1. **Assess learner level** first (see teach-runtime.ts § Learner Level Detection)
2. **Recommend a path**: "Based on your foundation, I recommend starting with Path A"
3. **Go topic by topic**: Each topic is independent enough to pause/resume
4. **After each topic**: Summarize key takeaways, suggest next topic
5. **Adjust pace**: If a topic feels too easy → skip to next. Too hard → explain specific confusion
6. **Track progress**: Use Session Memory to note completed topics and suggest next

---

## Quick Start Recommendations

| Learner says | Recommend |
|---|---|
| "I know nothing about this" | Path A, start at A1 |
| "I want to learn basic operations" | Path B, start at B1 |
| "I want deep understanding" | Path C, start at C1 |
| "I just want to learn one specific thing" | Direct teaching, no path |
| "I want systematic learning" | Recommend Path A/B/C based on level |

---

## Custom Paths

Learners can create custom paths:

1. Ask learner what they want to achieve
2. Break down into logical sequence
3. Estimate duration for each topic
4. Create custom path document
5. Track progress in session memory

---

## Path Selection Guide

### When to recommend Path A (Foundations)
- Learner says "I know nothing"
- Learner uses basic terminology incorrectly
- Learner asks very basic questions
- No prior experience mentioned

### When to recommend Path B (Practical Skills)
- Learner knows the basics
- Learner wants to apply knowledge
- Learner asks "how to" questions
- Some experience mentioned

### When to recommend Path C (Deep Understanding)
- Learner already has practical experience
- Learner asks "why" questions
- Learner wants to understand trade-offs
- Significant experience mentioned

---

## Progress Tracking

Track progress across sessions:

```markdown
## Learning Progress

### Current Path: Path B (Practical Skills)

| # | Topic | Status | Date | Notes |
|---|-------|--------|------|-------|
| B1 | Real-world scenarios | ✅ Completed | 2026-06-10 | Good understanding |
| B2 | Problem-solving patterns | 🔄 In Progress | 2026-06-10 | Need more examples |
| B3 | Tools and techniques | ⏳ Not Started | — | — |
| B4 | Best practices | ⏳ Not Started | — | — |
| B5 | Common mistakes | ⏳ Not Started | — | — |
| B6 | Hands-on practice | ⏳ Not Started | — | — |
```

---

## Adapting Paths

Paths are guidelines, not rigid rules. Adapt based on:

1. **Learner's pace**: If they're fast, skip ahead. If slow, add more examples.
2. **Learner's interests**: If they're more interested in one area, spend more time there.
3. **Learner's goals**: If they have a specific goal, focus on relevant topics.
4. **Learner's feedback**: If they say "I already know this", move on.

---

## Example: Learning nanoPencil

### Path A: nanoPencil Basics (L0 → L1)

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| A1 | What is nanoPencil? | 5 min | — |
| A2 | Basic commands | 10 min | A1 |
| A3 | Navigation and files | 10 min | A2 |
| A4 | Simple conversations | 15 min | A3 |
| A5 | Using tools | 15 min | A4 |
| A6 | First real task | 15 min | A1-A5 |

### Path B: nanoPencil Intermediate (L1 → L2)

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| B1 | Session management | 15 min | A* |
| B2 | Custom configurations | 15 min | B1 |
| B3 | Advanced tools | 15 min | B2 |
| B4 | Extensions | 20 min | B3 |
| B5 | Troubleshooting | 10 min | B4 |
| B6 | Real-world workflow | 20 min | B1-B5 |

### Path C: nanoPencil Advanced (L2 → L3)

| # | Topic | Duration | Builds On |
|---|-------|----------|-----------|
| C1 | Architecture deep dive | 20 min | B* |
| C2 | Custom extensions | 15 min | C1 |
| C3 | Performance optimization | 15 min | C2 |
| C4 | Integration patterns | 15 min | C3 |
| C5 | Contributing to nanoPencil | 20 min | C4 |
| C6 | Expert techniques | 20 min | C1-C5 |
