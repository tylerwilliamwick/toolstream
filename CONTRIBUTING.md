# Contributing to Toolstream

Thanks for your interest in contributing.

## Prerequisites

- Node 20 or higher
- npm 9 or higher

## Development Setup

```bash
git clone https://github.com/tylerwilliamwick/toolstream.git
cd toolstream
npm ci
npm run build
```

## Running Tests

```bash
# Full test suite
npm test

# Watch mode
npm run test:watch

# Smoke tests only
npm run test:smoke
```

## Making Changes

1. Fork the repository and create a branch off `main`.
2. Make your changes. New features and bug fixes should include tests.
3. Run `npm test` and confirm all tests pass.
4. Open a pull request against `main` with a clear description of what changed and why.

Keep PRs focused. One logical change per PR makes review faster.

## Commit Format

This project uses [Conventional Commits](https://www.conventionalcommits.org/).

```
feat: add semantic routing cache
fix: handle empty tool list on startup
docs: update README with new config options
chore: bump vitest to 4.2.0
test: add smoke test for proxy reconnect
```

Breaking changes: use `feat!:` as the type, or add `BREAKING CHANGE:` in the commit footer.

```
feat!: remove legacy config format

BREAKING CHANGE: The `servers` key in config is now required.
```

## Reporting Bugs

Open an issue on GitHub. Include:

- Node version (`node --version`)
- OS and version
- Steps to reproduce
- What you expected vs. what happened

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
