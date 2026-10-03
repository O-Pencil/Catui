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

```
Catui/
├── packages/           # Core packages
│   ├── agent-core/    # Agent framework
│   ├── ai/            # LLM integration
│   ├── tui/           # Terminal UI
│   ├── mem-core/      # Memory system
│   └── soul-core/     # AI personality
├── modes/             # Interaction modes
├── extensions/        # Plugin system
├── cli.ts             # CLI entry point
└── core/              # Core logic
```

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
