# Contributing to Catui

Thank you for your interest in contributing to Catui!

## Code of Conduct

Before contributing, please read our [Code of Conduct](./CODE_OF_CONDUCT.md).
By participating, you agree to uphold our community standards.

## How Can I Contribute?

### Reporting Bugs

- Search existing [issues](https://github.com/O-Pencil/Catui/issues) before creating a new one
- Use the **Bug Report** template when available
- Include:
  - Node.js and npm versions
  - Minimal reproduction steps
  - Expected vs actual behavior
  - Error messages and stack traces

### Suggesting Features

- Open a **Feature Request** issue with the `enhancement` label
- Describe the use case and why it would benefit the project
- Explain how it aligns with Catui's vision (persistent memory, AI personality evolution)

### Pull Requests

1. **Fork the repository** and create your branch:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

2. **Set up development environment**:
   ```bash
   # Requirements: Node.js >= 20
   npm install
   npm run build
   ```

3. **Make your changes**:
   - Write clean, maintainable TypeScript code
   - Follow existing code style
   - Add tests if applicable
   - Update documentation as needed

4. **Commit your changes**:
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve issue #123"
   ```

   We use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `refactor:` Code refactoring
   - `test:` Adding or updating tests
   - `chore:` Maintenance tasks

5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```

6. **Ensure PR description** includes:
   - What the change does
   - Why it's needed
   - Related issue numbers (e.g., "Closes #123")

### Development Workflow

```bash
# Run in development mode
npm run dev

# Build for production
npm run build

# Run tests (if available)
npm test

# Type check
npx tsc --noEmit
```

## Project Structure

See [`AGENTS.md`](./AGENTS.md) for the full architecture map. The shorthand:

```
Catui/
├── cli.ts, main.ts, config.ts, index.ts   # SDK / CLI entry surface
├── core/
│   ├── runtime/                            # AgentSession facade + focused runtime owners
│   ├── lib/{ai,agent-core,tui}/            # Private runtime libraries (npm workspaces)
│   ├── platform/                           # Config / i18n / telemetry / exec / utils
│   ├── extensions-host/                    # Extension loader / runner / types
│   ├── tools/                              # bash / read / edit / write / grep / find / ls / source
│   ├── mcp/                                # MCP client + adapter
│   ├── session/                            # Session manager + compaction
│   ├── model/                              # Model registry + providers
│   ├── prompt/                             # System prompt + prompt templates
│   ├── sub-agent/                          # Agent tool + worktree isolation
│   └── workspace/                          # Worktree manager
├── modes/{interactive,print,rpc,acp,remote}   # Run modes
├── extensions/{builtin,optional}/            # Built-in and opt-in extensions
├── packages/{protocol,mem-core}/             # Published protocol + memory packages
│   # soul-core is retained standalone, outside the root workspace
└── apps/mobile/                             # Mobile web UI (separate toolchain)
```

Detailed P2 module lists live in each module's `AGENT.md`; the full P3 contracts live in source headers.

## Style Guidelines

- Use **TypeScript** with strict mode
- 2 spaces for indentation
- Use `ES2022` module syntax (`import`/`export`)
- Add type annotations for function parameters and return values
- Keep functions small and focused

## License

By contributing, you agree that your contributions will be licensed under the GNU General Public License v3.0 (GPL-3.0).

## Questions?

- Open an issue for bugs or feature requests
- Join discussions in GitHub Issues

We appreciate all contributions, from bug reports to documentation improvements!
