# Teach Extension

> P2 | Guided knowledge teaching extension for nanoPencil

## Overview

The teach extension provides guided, source-verified learning for any topic. It implements a progressive teaching methodology with analogies, source verification, and learning progress tracking.

## Features

- **Progressive Teaching**: Hook → Level 1 → Level 2 → Level 3 → Bridge → Takeaways
- **Source Verification**: Every fact has a verifiable source with confidence level
- **Learning Styles**: Quick Overview, Deep Dive, Focused Skill, Holistic
- **Learner Level Detection**: Adapts to L0-L3 levels automatically
- **Session Memory**: Tracks glossary, depth, coverage, and questions
- **Learning Records**: Persists progress to `.nanopencil/teach/`

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point, registers /teach command and teach tool |
| `teach-runtime.ts` | Core teaching state machine |
| `teach-prompts.ts` | Prompt templates for each teaching level |
| `teach-format.ts` | Output formatting utilities |
| `teach-types.ts` | TypeScript type definitions |
| `teach-i18n.ts` | Internationalization (en/zh) |
| `teach-persistence.ts` | Learning record and mission persistence |
| `references/analogy-library.md` | Curated analogies for common concepts |
| `references/teaching-template.md` | Lesson structure templates |
| `references/learning-paths.md` | Structured curricula for different levels |
| `references/source-verification.md` | Source citation rules and hierarchy |

## Usage

### Command

```
/teach <topic>
```

Example:
```
/teach how to cook pasta
/teach React hooks
/teach machine learning basics
```

### Tool

The agent can use the `teach` tool:

```json
{
  "name": "teach",
  "parameters": {
    "topic": "cooking pasta",
    "action": "start"
  }
}
```

Actions:
- `start`: Begin teaching a new topic
- `respond`: Process user's response
- `status`: Get current teaching state

## Teaching Flow

### Phase 1: Mission Discovery

Understand the learner's goals:
- Why do they want to learn this?
- What do they already know?
- What's their success criteria?

### Phase 2: Learning Style Selection

Choose the appropriate depth:
- **Quick Overview** (10-15 min): Just the essentials
- **Deep Dive** (30-60 min): Comprehensive understanding
- **Focused Skill** (20-30 min): Master one specific thing
- **Holistic** (multiple sessions): Become an expert

### Phase 3: Progressive Teaching

Teach layer by layer:
- **Hook** (Level 0): Why should you care?
- **Level 1**: One-sentence version + core analogy
- **Level 2**: How it works + example
- **Level 3**: Deep dive + real scenario
- **Bridge**: What this means for you
- **Takeaways**: 3 core points

### Phase 4: Progress Tracking

Save learning records and suggest next steps.

## Source Verification

Every factual claim must include:
- Source name and URL
- Confidence level (⭐⭐⭐⭐⭐)
- Verification method

Source hierarchy:
1. ⭐⭐⭐⭐⭐ Official documentation, peer-reviewed papers
2. ⭐⭐⭐⭐ Recognized experts, established institutions
3. ⭐⭐⭐ Community sources (Stack Overflow, Reddit)
4. ⭐⭐ Blog posts, tutorials
5. ⭐ User-generated content

## Learner Level Detection

The extension automatically detects the learner's level:

| Level | Signals | Adaptation |
|-------|---------|------------|
| L0 零基础 | "What is", "completely不懂" | All life analogies, no technical terms |
| L1 入门 | Knows basic concepts | Bridge from known concepts |
| L2 进阶 | Knows core concepts | Use real examples |
| L3 熟练 | Asks about details/principles | Direct discussion of architecture |

## Learning Paths

Structured curricula for different levels:
- **Path A**: Foundations (L0 → L1)
- **Path B**: Practical Skills (L1 → L2)
- **Path C**: Deep Understanding (L2 → L3)

See `references/learning-paths.md` for details.

## Persistence

Learning records are saved to:
```
.nanopencil/teach/
├── records/          # Learning records
├── missions/         # Mission documents
└── glossary.json     # Term glossary
```

## Integration

### With Agent

The teach extension integrates with the agent through:
- `/teach` command registration
- `teach` tool for agent use
- Teach renderer for custom message display

### With Other Extensions

- Uses `interview` tool for mission discovery
- Uses `link-world` for source verification (when available)
- Uses session persistence for learning records

## Configuration

No special configuration required. The extension:
- Auto-detects locale from settings
- Uses workspace path for persistence
- Adapts to learner level automatically

## Development

### Adding New Analogies

Edit `references/analogy-library.md` to add new analogies.

### Adding New Learning Paths

Edit `references/learning-paths.md` to add new paths.

### Customizing Prompts

Edit `teach-prompts.ts` to customize teaching prompts.

### Adding Languages

Edit `teach-i18n.ts` to add new language support.

## Dependencies

- `core/extensions-host/types.ts`: Extension API
- `core/session/session-manager.ts`: Session persistence (optional)
- `node:fs`, `node:path`: File operations for persistence

## Version History

- **v1.0.0** (2026-06-10): Initial release
  - Progressive teaching flow
  - Source verification
  - Learning style selection
  - Learner level detection
  - Session memory
  - Learning record persistence
