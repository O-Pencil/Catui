# §1 Ecosystem Panorama

> Complete topology, architecture layers, and data flow across 10+ projects

<!--
[WHO]  Panoramic view of all Catui-ecosystem projects
[FROM] PROJECT_OVERVIEW.md + catui-platform-charter.md §2
[TO]   02-boundaries, 03-relations, each project's README
[HERE] charter/01-ecosystem.md — panoramic overview
-->

---

## 1.1 Project space layout

```
D:\Projects\Catui\
├── Catui/                        # Core mind runtime
├── Catui-Agent-Gateway/          # PAAS gateway service
├── O-Mesh/                       # Multi-agent orchestration engine
├── Catui-Evaluate/               # Agent evaluation framework
├── Asgard-platform/              # Infrastructure / platform layer
│   ├── packages/api (Asgard-api) # FastAPI backend
│   └── packages/web (Asgard-web) # React frontend
├── catui-editor/                 # Authoring expression layer (editor)
├── Catui-Eidolon/                # Browser extension layer (Chrome/Edge MV3 plugin)
├── Catui-Game/                   # Social-game expression layer
├── Catui-Lesson/                 # Knowledge-acquisition expression layer
├── Catui-Terminal/               # Embodied environment / terminal
├── Catui-Playground/             # (planned) online experiment arena
└── Catui-Eidolon/                # Browser infiltration layer
```

## 1.2 Git repository remotes

| Repository | GitHub remote | Default branch | Notes |
|------------|---------------|----------------|-------|
| **Catui** | `O-Pencil/Catui` | `main` | remote name `github` |
| **Catui-Agent-Gateway** | `O-Pencil/Catui-Agent-Gateway` | `main` | — |
| **O-Mesh** | `O-Catui/O-Mesh` | `main` | — |
| **Catui-Evaluate** | `O-Pencil/Catui-Evaluate` | `main` | — |
| **catui-editor** | `O-Pencil/catui-editor` | `dev` | default branch `dev` |
| **Asgard-platform** | `O-Catui/Asgard-platform` | `main` | contains submodules |
| **Asgard-api** | `O-Catui/Asgard-api` | `main` | Asgard submodule |
| **Asgard-web** | `O-Catui/Asgard-web` | `main` | Asgard submodule |
| **Catui-Eidolon** | `O-Pencil/Catui-Eidolon` | `main` | Chrome/Edge MV3 |
| **Catui-Game** | `O-Pencil/Catui-Game` | `main` | — |
| **Catui-Lesson** | `O-Pencil/Catui-Lesson` | `main` | — |
| **Catui-Terminal** | `O-Pencil/Catui-Terminal` | `main` | has dependabot PR |

All repositories belong to the GitHub organization **[O-Catui](https://github.com/O-Catui)**.

## 1.3 Architecture layer model

```
┌─────────────────────────────────────────────────────────────────┐
│                      Platform Layer                              │
│              Asgard-platform (user entry / Agent marketplace)    │
├─────────────────────────────────────────────────────────────────┤
│                      Infiltration Layer                          │
│              Catui-Eidolon (browser-side panel plugin)          │
├─────────────────────────────────────────────────────────────────┤
│                      Expression Layer                            │
│   catui-editor    Catui-Game    Catui-Lesson                    │
│   (authoring)            (gaming)        (learning)             │
├─────────────────────────────────────────────────────────────────┤
│                      Gateway Layer                               │
│              Catui-Agent-Gateway (HTTP + SSE)                   │
├─────────────────────────────────────────────────────────────────┤
│                      Orchestration Layer                         │
│                     O-Mesh (multi-agent orchestration)           │
├─────────────────────────────────────────────────────────────────┤
│                      Ontology Layer                              │
│                     Catui (mind core)                            │
│         NanoSoul (personality) + NanoMem (memory) + AI Core      │
├─────────────────────────────────────────────────────────────────┤
│                      Embodiment Layer                            │
│              Catui-Terminal (physical-world operations)          │
├─────────────────────────────────────────────────────────────────┤
│                      Evaluation Layer                            │
│              Catui-Evaluate (end-to-end self-reflection)         │
└─────────────────────────────────────────────────────────────────┘
```

## 1.4 Call-chain topology

```
                                              ┌─────────────────────────────────┐
   Catui CLI (local)  ─── ACP ───────────►│    catui-agent engine (in-proc)   │
                                              └─────────────────────────────────┘

   catui-editor (local ACP mode)  ── ACP ──►  catui-agent CLI child process

   catui-editor (Remote HTTP mode)  ┐
                                          │
   Catui CLI (remote mode)              ├── HTTP+SSE + API Key ──► Catui-Agent-Gateway
                                          │                          │
   Third-party OpenAI clients             ┘                          ▼
                                                              ┌─────────────────────┐
                                                              │ CatuiAgent instance  │
                                                              │  = catui-agent       │
                                                              │  + Soul + Memory     │
                                                              │  + Model + Personal. │
                                                              └─────────────────────┘
                                                              (multi-instance inside Gateway)

   Asgard user  ──── HTTP ──►  Asgard Platform  ── HTTP proxy ──►  Catui-Agent-Gateway
                                  │
                                  └── create CatuiAgent / write-back usage / billing

   DingTalk / WeChat / Feishu events  ──► Catui-Agent-Gateway Channel submodule  ──► CatuiAgent

   User browser (any page)  ────►  Catui-Eidolon Side Panel
                               ├── local mode: Native Messaging → Catui
                               └── cloud mode: OpenAI-compatible API → Gateway

   O-Mesh Orchestrator  ────►  schedule multiple Catui instances  ──►  Blackboard horizontal comms

   Catui-Evaluate  ────►  run evaluation test suites  ──►  produce capability report  ──►  feedback to Catui
```

## 1.5 Core data flow

```
User intent
    ↓
┌─────────────────────────────────────────────────────┐
│                  Asgard-platform                     │
│         (Agent Marketplace / Chat / Console)        │
└─────────────────────────────────────────────────────┘
    ↓
┌──────────────────────────────────────┐
│          Catui-Eidolon              │
│     (browser infiltration: any page) │
└──────────────────────────────────────┘
    ↓
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Expression   │ ←→ │ Gateway      │ ←→ │ 3rd-party   │
│ (Editor/Game)│    │ (Gateway)    │    │ apps        │
└─────────────┘    └─────────────┘    └─────────────┘
    ↓
┌─────────────┐
│ Orchestr.    │ ←→ O-Mesh Orchestrator
│ (O-Mesh)     │ ←→ Blackboard horizontal comms
└─────────────┘
    ↓
┌─────────────┐    ┌─────────────┐
│ Ontology     │ ←→ │ Embodiment   │
│ (Catui)      │    │ (Terminal)   │
│ NanoSoul     │    │ file/Git/Shell│
│ NanoMem      │    └─────────────┘
└─────────────┘
    ↓
┌─────────────┐
│ Evaluation   │ → feedback optimize → Ontology
│ (Evaluate)   │
└─────────────┘
```
