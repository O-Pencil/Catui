# Teaching Template

Standard lesson structure for teach command. Adapt depth and pacing to learner's level.

---

## Lesson Structure

```
┌─────────────────────────────────────────────────────────┐
│  HOOK           (30 sec)    Why should you care?        │
│  ↓                                                       │
│  LEVEL 1        (1 min)     One-sentence + core analogy │
│  ↓                                                       │
│  LEVEL 2        (3 min)     How it works + example      │
│  ↓                                                       │
│  LEVEL 3        (5+ min)    Deep dive + real scenario   │
│  ↓                                                       │
│  BRIDGE         (1 min)     What this means for you     │
│  ↓                                                       │
│  TAKEAWAYS      (30 sec)    3 core points               │
└─────────────────────────────────────────────────────────┘
```

---

## HOOK Template

```markdown
### 🎣 Why should you learn about「{topic}」？

[A relatable scenario or problem]

Examples:
- "Have you ever encountered {situation}? Understanding {topic} will help you {capability}."
- "Every time {situation}, {problem}——understanding {topic} makes {benefit}."
```

---

## LEVEL 1 Template (Zero Jargon)

```markdown
### 📍 One-sentence version

**{topic}** is {plain-language definition}.

Think of it like: {analogy from analogy-library.md}

That's the basics. Let's see how it actually works.
```

---

## LEVEL 2 Template (Working Knowledge)

```markdown
### 🔍 How it works

**Core concepts**:
- 「{term-1}」→ {one-sentence explanation}
- 「{term-2}」→ {one-sentence explanation}
- 「{term-3}」→ {one-sentence explanation}

**Simple example**:

```{language}
// {What this example does}
{5-15 lines of annotated code}
// ← {Comment explaining this line}
```

**Flowchart**:

```mermaid
{Simplified flowchart, 3-5 nodes}
```

**Comparison**:

| What you already know | What's new |
|----------------------|------------|
| {Existing concept} | {New concept} |
```

---

## LEVEL 3 Template (Deep Dive, Optional)

```markdown
### 🐇 Deep dive (optional)

In real-world applications, {topic} gets more complex:

1. **{complication-1}**: {explanation + why it exists}
2. **{complication-2}**: {explanation + common pitfalls}
3. **{complication-3}**: {explanation + best practices}

**Real-world example**:
```{language}
// From real-world code (simplified)
{real code example with annotations}
```

**When you'll encounter it**:
- {Scenario 1: Design review}
- {Scenario 2: Code review}
- {Scenario 3: Technical discussion}
```

---

## BRIDGE Template

```markdown
### 🌉 What this means for you

Understanding {topic} helps you:

1. **When designing**: {how it improves design decisions}
2. **When collaborating**: {how it improves communication}
3. **When reviewing**: {what to look for or ask about}

**Useful phrases**:
- "How does our {feature}'s {topic} work?"
- "If we change the {topic} approach, what are the limitations?"
```

---

## TAKEAWAYS Template

```markdown
### ✨ Remember these three things

1. {Core concept, one sentence}
2. {Practical value, one sentence}
3. {Growth opportunity, one sentence}

---

**Want to explore more?**
- Try applying what you learned in a real scenario
- Ask questions about specific aspects you're curious about
- Practice with hands-on exercises
```

---

## Pacing Rules

| Signal from learner | Action |
|---|---|
| "Yes, continue" or proactive questions | Can go to next level |
| "A bit confused" or silence | Stay at current level, add another analogy |
| "I already know this" | Skip to next level or deeper topic |
| "Enough, let me digest" | Wrap up with takeaways, no more depth |
| Asks a tangent question | Briefly address it, then return to main thread |

---

## Code Example Rules

1. **Maximum 15 lines** per example at Level 2
2. **Every line must have a comment** explaining what it does
3. **Use the simplest possible example** that demonstrates the concept
4. **Prefer functional examples** that can be copy-pasted and run
5. **Highlight the "aha!" line** — the one that demonstrates the concept most clearly
6. **Remove all boilerplate** that isn't essential to understanding

---

## Analogy Selection Rules

1. **One analogy per concept per session** — don't mix metaphors
2. **Check analogy library first** — use established analogies when available
3. **Note confidence level** — be honest about how well the analogy fits
4. **Acknowledge limitations** — when an analogy breaks down, say so
5. **Provide alternatives** — have backup analogies ready

---

## Source Verification Rules

Every factual claim must include:

```markdown
**Source**: [Source Name](URL)
**Confidence**: ⭐⭐⭐⭐⭐ (Reason)
**Verification method**: [How verified]
```

### Source Hierarchy

| Level | Source Type | Confidence |
|-------|------------|------------|
| 1 | Official documentation, peer-reviewed papers | ⭐⭐⭐⭐⭐ |
| 2 | Recognized experts, established institutions | ⭐⭐⭐⭐ |
| 3 | Community sources (Stack Overflow, Reddit) | ⭐⭐⭐ |
| 4 | Blog posts, tutorials | ⭐⭐ |
| 5 | User-generated content | ⭐ |

---

## Feynman Check

After key teaching points, always ask:

> "Can you describe this in your own words?"

This helps:
1. Solidify understanding
2. Identify gaps in knowledge
3. Build confidence in explaining to others

---

## Error Recovery

When teaching doesn't land:

1. **Recognize confusion**: Watch for signs of misunderstanding
2. **Pause and clarify**: Don't keep pushing forward
3. **Try a different angle**: Use a different analogy or explanation
4. **Simplify**: Break down into smaller pieces
5. **Check prerequisites**: Ensure foundation is solid

---

## Session Memory

Across lessons in a single session, maintain:

- **Glossary**: all terms introduced so far (avoid re-explaining)
- **Depth level**: track how much the learner has absorbed
- **Coverage**: what areas have been taught
- **Questions asked**: to identify knowledge gaps and suggest next topics
