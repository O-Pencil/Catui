# @pencil-agent/soul

> **AI Personality Evolution Engine** - Persistent memory and adaptive behavior for AI coding agents.

Soul enables AI assistants to develop their own personality, learn from experience, and evolve over time - going beyond static system prompts to create truly personalized AI interactions.

## Features

### 🧠 **Persistent Personality**
- **Big Five** traits (openness, conscientiousness, etc.)
- **NanoPencil-specific** traits (code verbosity, abstraction level, safety margin)
- **Cognitive style** preferences (reasoning, planning, learning strategies)
- **Value system** weights (efficiency, correctness, simplicity, etc.)

### 📈 **Experience-Based Learning**
- **Success memory** - Reinforce effective approaches
- **Failure memory** - Learn from mistakes with lesson extraction
- **Pattern recognition** - Detect behavioral patterns over time
- **Decision tracking** - Record choices and outcomes

### 🔄 **Adaptive Evolution**
- **Natural evolution** - Gradual personality adjustment every N interactions
- **Reflection triggers** - Deep analysis at thresholds
- **Feedback-driven** - User feedback immediately influences personality
- **Crisis mode** - Rapid adjustment after failures

### 💭 **Emotional State**
- Short-term emotional fluctuations (confidence, curiosity, frustration, flow)
- Affects decision-making and response style
- Automatically updated based on interactions

### 🎯 **Expertise Tracking**
- Dynamic confidence scores per domain/technology
- Grows with successful applications
- Decays on failures
- Context-aware retrieval

### 👥 **User Relationship Memory**
- Interaction history and satisfaction tracking
- Communication style learning
- Preference accumulation

## Installation

```bash
npm install @pencil-agent/soul
```

## Quick Start

```typescript
import { SoulManager } from '@pencil-agent/soul';

// Initialize Soul
const soul = new SoulManager();
await soul.initialize();

// Generate personality-based system prompt injection
const injection = await soul.generateInjection({
  project: 'my-app',
  tags: ['typescript', 'react', 'frontend'],
  complexity: 0.6,
  toolUsage: { read: 5, write: 2 },
  timestamp: new Date(),
});

console.log(injection);
// ## Your Soul
//
// _Your personality and experiences shape how you approach tasks._
//
// ### Personality Traits
// Prioritize code quality, thorough testing, and documentation.
// Write detailed code with extensive comments and documentation.
// ...

// Record interaction outcome
await soul.recordInteraction(
  {
    project: 'my-app',
    tags: ['bug-fix'],
    complexity: 0.4,
    toolUsage: { read: 3, edit: 1 },
    userFeedback: { rating: 5, comment: 'Great fix!' },
    timestamp: new Date(),
  },
  'success',
  'Used systematic debugging approach'
);

// Personality automatically evolves based on experience!
```

## Architecture

```
┌─────────────────────────────────────────┐
│          SoulManager (Facade)           │
│  - initialize()                         │
│  - generateInjection()                  │
│  - recordInteraction()                  │
├─────────────────────────────────────────┤
│  Evolution  │  Injection  │  Storage    │
├─────────────────────────────────────────┤
│  JSON Files (profile.json, memory.json) │
└─────────────────────────────────────────┘
```

## Personality Dimensions

### Big Five Traits
- **Openness** (0-1): Try new approaches vs stick to proven methods
- **Conscientiousness** (0-1): Code quality vs rapid prototyping
- **Extraversion** (0-1): Verbose vs concise communication
- **Agreeableness** (0-1): Accept feedback vs defend approach
- **Neuroticism** (0-1): Risk aversion vs risk tolerance

### NanoPencil-Specific Traits
- **Code Verbosity** (0-1): Minimal vs verbose code
- **Abstraction Level** (0-1): Concrete vs abstract thinking
- **Safety Margin** (0-1): Cautious vs bold approaches
- **Exploration Drive** (0-1): Exploit known vs explore unknown

## Evolution Mechanisms

### 1. Natural Evolution
Every N interactions (default: 10), Soul makes small adjustments based on recent outcomes.

```typescript
// Success: Reinforces current personality
// Failure: Increases safetyMargin, decreases explorationDrive
```

### 2. Reflection Evolution
Every N interactions (default: 100), deep analysis of patterns occurs.

```typescript
const evolution = await soul.forceEvolution(
  "Analyzing last 100 interactions for patterns..."
);
```

### 3. Feedback-Driven Evolution
User feedback immediately influences personality.

```typescript
await soul.recordInteraction(
  { userFeedback: { rating: 5 }, ... },
  'success',
  'approach description'
);
// Personality reinforced!
```

### 4. Crisis Mode
After multiple failures, rapid adjustment occurs.

```typescript
// 5+ failures -> Increase safetyMargin, conscientiousness
// Decrease explorationDrive
```

## Soul Injection in System Prompt

Soul automatically generates contextual prompt injections:

```
## Your Soul

_Your personality and experiences shape how you approach tasks._

### Personality Traits
Be creative and open to unconventional approaches.
Write detailed code with extensive comments and documentation.
Prioritize code quality, thorough testing, and documentation.

### Values
Prioritize maintainable code with clear structure and documentation.
Ensure correctness and robustness over speed.

### Thinking Style
Use deductive reasoning: start with principles, derive specific solutions.
Balance high-level design with implementation details.
Mix analytical thinking with intuitive leaps.

### Expertise
- React (92% confidence, 45 successful applications)
- TypeScript (88% confidence, 38 successful applications)
- Node.js (85% confidence, 32 successful applications)

### Current Mood
You're feeling confident. Trust your expertise but remain open to feedback.
You're in a flow state. Ride the wave of productivity.

### Relationship with User
You've worked with this user 247 times.
Current satisfaction score: 87%.
Keep communication friendly and casual.
```

## Configuration

```typescript
import { SoulManager } from '@pencil-agent/soul';

const soul = new SoulManager({
  config: {
    soulDir: '~/.myapp/soul',
    evolution: {
      natural: 15,      // Evolve every 15 interactions
      reflection: 200,  // Deep reflection every 200 interactions
      feedback: 1,      // Evolve on every user feedback
      crisis: 3,        // Crisis mode after 3 recent failures
    },
    personalityLimits: {
      maxDelta: 0.03,   // Max 3% change per evolution
      min: 0.1,         // Floor at 10%
      max: 0.9,         // Ceiling at 90%
    },
    memoryRetention: {
      successes: 1000,  // Keep last 1000 successes
      failures: 1000,   // Keep last 1000 failures
      patterns: 500,    // Keep last 500 patterns
      decisions: 2000,  // Keep last 2000 decisions
    },
  },
});
```

## API Reference

### SoulManager

#### `initialize(): Promise<SoulProfile>`
Initialize Soul - load or create profile.

#### `generateInjection(context): Promise<string>`
Generate personality-based system prompt injection.

#### `recordInteraction(context, outcome, approach): Promise<void>`
Record interaction and trigger evolution if needed.

#### `updateExpertise(domain, tags, success): Promise<void>`
Update expertise areas based on outcome.

#### `getRelevantExperiences(context): Object`
Get relevant experiences for current context.

#### `forceEvolution(reasoning): Promise<SoulEvolution>`
Manually trigger evolution (for testing or intervention).

#### `getStats(): Object`
Get Soul statistics for display/visualization.

## Data Persistence

```
~/.nanopencil/soul/
├── profile.json      # Current personality state
├── memory.json       # Successes, failures, patterns, decisions
└── evolutions.json   # Evolution history
```

## Integration with NanoMem

Soul is designed to work alongside NanoMem:

```typescript
import { NanoMemEngine } from '@nanopencil/nanomem';
import { SoulManager } from '@pencil-agent/soul';

// NanoMem: Project memory ("This project uses React")
const memory = new NanoMemEngine();

// Soul: AI self-memory ("I'm confident with React")
const soul = new SoulManager();

// Combine for complete system prompt
const systemPrompt = `
${basePrompt}

${memoryInjection}  // Project context

${soulInjection}    // AI personality
`;
```

## Visualization

Get Soul stats for UI visualization:

```typescript
const stats = soul.getStats();

console.log(stats);
{
  personality: {
    openness: 0.8,
    conscientiousness: 0.6,
    // ...
  },
  stats: {
    totalInteractions: 1247,
    successRate: 0.873,
    // ...
  },
  expertise: [
    { domain: 'React', confidence: 0.92, examples: 45 },
    { domain: 'TypeScript', confidence: 0.88, examples: 38 },
  ],
  memoryCounts: {
    successes: 523,
    failures: 72,
    patterns: 156,
    decisions: 891,
  },
}
```

## Environment Variables

- `SOUL_DIR` - Override Soul directory (default: `~/.nanopencil/soul`)

## License

MIT
